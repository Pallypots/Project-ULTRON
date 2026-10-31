// Prints results recorded by tests (helpers.ts ciNote) as GitHub notices, in a step of its own.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const file = join(process.env.RUNNER_TEMP ?? ".", "ultron-ci-notes.jsonl");
if (!existsSync(file)) {
  console.log("no CI notes recorded");
  process.exit(0);
}
// Workflow-command escaping: % first, then line breaks; titles also escape ":" and ",".
const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escTitle = (s) => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
  const { title, message } = JSON.parse(line);
  console.log(`::notice title=${escTitle(title)}::${esc(message).slice(0, 4000)}`);
}
