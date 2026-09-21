"""Run after forge build --root sc; exports only the public ABI, never deployment secrets."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
artifact = json.loads((root / "sc/out/DistributionCertificateNFT.sol/DistributionCertificateNFT.json").read_text())
(root / "shared/certificate-nft-abi.ts").write_text(
    "// Generated from sc/src/DistributionCertificateNFT.sol by scripts/export-certificate-nft-abi.py.\n"
    + "export const certificateNftAbi = " + json.dumps(artifact["abi"], indent=2) + " as const;\n"
)
