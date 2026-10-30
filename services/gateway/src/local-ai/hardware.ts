import { execFile } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Gpu {
  name: string;
  /** Dedicated video memory in bytes (0 if unknown/shared). */
  vramBytes: number;
  vendor: "nvidia" | "amd" | "intel" | "other";
}

export interface Hardware {
  ramBytes: number;
  cpuThreads: number;
  gpus: Gpu[];
  /** Best GPU Ollama can actually use (NVIDIA/AMD with dedicated memory). */
  usableGpu: Gpu | null;
}

const vendorOf = (name: string): Gpu["vendor"] =>
  /nvidia|geforce|rtx|gtx|quadro|tesla/i.test(name) ? "nvidia" : /amd|radeon/i.test(name) ? "amd" : /intel|arc|iris|uhd/i.test(name) ? "intel" : "other";

async function nvidiaSmi(): Promise<Gpu[]> {
  const { stdout } = await run("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], { timeout: 5000, windowsHide: true });
  return stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name = "NVIDIA GPU", mib = "0"] = line.split(",").map((s) => s.trim());
      return { name, vramBytes: Number(mib) * 1024 * 1024, vendor: "nvidia" as const };
    });
}

// Windows: the display-adapter registry keys hold the true dedicated memory size (WMI's AdapterRAM caps at 4 GB).
const WINDOWS_GPU_PS = `
$out = @()
Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue | ForEach-Object {
  $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
  if ($p -and $p.DriverDesc) {
    $m = $p.'HardwareInformation.qwMemorySize'
    if (-not $m) { $m = $p.'HardwareInformation.MemorySize' }
    if ($m -is [byte[]]) { if ($m.Length -ge 8) { $m = [BitConverter]::ToInt64($m, 0) } elseif ($m.Length -ge 4) { $m = [BitConverter]::ToUInt32($m, 0) } else { $m = 0 } }
    $out += [pscustomobject]@{ name = [string]$p.DriverDesc; vram = [int64]$m }
  }
}
ConvertTo-Json -Compress -InputObject @($out)
`;

async function windowsGpus(): Promise<Gpu[]> {
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_GPU_PS], { timeout: 15000, windowsHide: true });
  const parsed = JSON.parse(stdout.trim() || "[]") as { name: string; vram: number }[];
  return parsed.map((g) => ({ name: g.name, vramBytes: Math.max(0, Number(g.vram) || 0), vendor: vendorOf(g.name) }));
}

export function pickUsableGpu(gpus: Gpu[]): Gpu | null {
  const usable = gpus.filter((g) => (g.vendor === "nvidia" || g.vendor === "amd") && g.vramBytes >= 2 * 1024 ** 3);
  return usable.sort((a, b) => b.vramBytes - a.vramBytes)[0] ?? null;
}

let cached: Hardware | null = null;

/** Detects RAM and GPUs. Never throws: unknown hardware just means a conservative recommendation. */
export async function detectHardware(force = false): Promise<Hardware> {
  if (cached && !force) return cached;
  let gpus: Gpu[] = [];
  try {
    gpus = await nvidiaSmi();
  } catch {
    /* no NVIDIA driver tools */
  }
  if (process.platform === "win32") {
    try {
      const reg = await windowsGpus();
      // nvidia-smi is the most accurate for NVIDIA; add other adapters from the registry.
      for (const g of reg) if (!gpus.some((n) => n.name === g.name)) gpus.push(g);
    } catch {
      /* PowerShell unavailable */
    }
  }
  cached = { ramBytes: totalmem(), cpuThreads: cpus().length, gpus, usableGpu: pickUsableGpu(gpus) };
  return cached;
}
