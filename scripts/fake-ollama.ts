// Starts the test stand-in for Ollama and prints its URL (used by the browser E2E test).
import { startFakeOllama } from "../services/gateway/test/fake-ollama.ts";

const fake = await startFakeOllama();
console.log(`FAKE_OLLAMA_URL=${fake.url}`);
