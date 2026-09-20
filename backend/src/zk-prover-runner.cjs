/**
 * Node.js runner for snarkjs Groth16 fullProve (Spec #100, Issue #108).
 *
 * Runs under Node (which has native worker_threads compatibility with snarkjs)
 * rather than Bun directly (Issue #108).
 */

const snarkjs = require("snarkjs");
const fs = require("fs");

async function run() {
  const [,, inputFile, wasmFile, zkeyFile, outputFile] = process.argv;
  if (!inputFile || !wasmFile || !zkeyFile || !outputFile) {
    console.error("Usage: node zk-prover-runner.cjs <input.json> <circuit.wasm> <circuit.zkey> <output.json>");
    process.exit(1);
  }

  const inputData = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputData, wasmFile, zkeyFile);

  const calldataStr = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const parsedCalldata = JSON.parse("[" + calldataStr + "]");

  const output = {
    proof,
    publicSignals,
    calldata: {
      a: parsedCalldata[0],
      b: parsedCalldata[1],
      c: parsedCalldata[2],
      input: parsedCalldata[3],
    },
  };

  fs.writeFileSync(outputFile, JSON.stringify(output), "utf8");
  process.exit(0);
}

run().catch(err => {
  console.error("Prover error:", err);
  process.exit(1);
});
