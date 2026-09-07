"""Run after forge build --root sc; exports only the public ABI, never deployment secrets."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
artifact = json.loads((root / "sc/out/ReportEvidenceRegistry.sol/ReportEvidenceRegistry.json").read_text())
(root / "shared/report-registry-abi.ts").write_text(
    "// Generated from sc/src/ReportEvidenceRegistry.sol by scripts/export-registry-abi.py.\n"
    + "export const reportRegistryAbi = " + json.dumps(artifact["abi"], indent=2) + " as const;\n"
)
