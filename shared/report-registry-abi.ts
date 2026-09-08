// Generated from sc/src/ReportEvidenceRegistry.sol by scripts/export-registry-abi.py.
export const reportRegistryAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "admission",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "AUTHORIZATION_TYPEHASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PUBLISH_REPORT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "RECORD_EVIDENCE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "VALIDATE_REPORT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "acceptAdministrator",
    "inputs": [
      {
        "name": "institutionId",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "administrators",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "admissionAuthority",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "authorizationDigest",
    "inputs": [
      {
        "name": "a",
        "type": "tuple",
        "internalType": "struct ReportEvidenceRegistry.Authorization",
        "components": [
          {
            "name": "action",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "institutionId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "reportId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "version",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "packageId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "predecessor",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "digest",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "policy",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "outcome",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "signer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "authorityEpoch",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "eip712Domain",
    "inputs": [],
    "outputs": [
      {
        "name": "fields",
        "type": "bytes1",
        "internalType": "bytes1"
      },
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "version",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "chainId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "verifyingContract",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "extensions",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "enrollInstitution",
    "inputs": [
      {
        "name": "institutionId",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "administrator",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "evidenceDigest",
    "inputs": [
      {
        "name": "institutionId",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "packageId",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "latestPublishedPackage",
    "inputs": [
      {
        "name": "institutionId",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "reportId",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "latestPublishedVersion",
    "inputs": [
      {
        "name": "institutionId",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "reportId",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingAdministrators",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proposeAdministrator",
    "inputs": [
      {
        "name": "institutionId",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "successor",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "publishReport",
    "inputs": [
      {
        "name": "a",
        "type": "tuple",
        "internalType": "struct ReportEvidenceRegistry.Authorization",
        "components": [
          {
            "name": "action",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "institutionId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "reportId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "version",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "packageId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "predecessor",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "digest",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "policy",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "outcome",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "signer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "authorityEpoch",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "signature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "v",
        "type": "tuple",
        "internalType": "struct ReportEvidenceRegistry.Authorization",
        "components": [
          {
            "name": "action",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "institutionId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "reportId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "version",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "packageId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "predecessor",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "digest",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "policy",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "outcome",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "signer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "authorityEpoch",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "validatorSignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "publishedPackageVersion",
    "inputs": [
      {
        "name": "institutionId",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "packageId",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "publishedVersion",
    "inputs": [
      {
        "name": "institutionId",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "reportId",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "version",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ReportEvidenceRegistry.Publication",
        "components": [
          {
            "name": "institution",
            "type": "tuple",
            "internalType": "struct ReportEvidenceRegistry.Authorization",
            "components": [
              {
                "name": "action",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "institutionId",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "reportId",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "version",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "packageId",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "predecessor",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "digest",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "policy",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "outcome",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "signer",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "authorityEpoch",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "nonce",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "deadline",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "validator",
            "type": "tuple",
            "internalType": "struct ReportEvidenceRegistry.Authorization",
            "components": [
              {
                "name": "action",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "institutionId",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "reportId",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "version",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "packageId",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "predecessor",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "digest",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "policy",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "outcome",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "signer",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "authorityEpoch",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "nonce",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "deadline",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "institutionSignature",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "validatorSignature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "recordEvidence",
    "inputs": [
      {
        "name": "a",
        "type": "tuple",
        "internalType": "struct ReportEvidenceRegistry.Authorization",
        "components": [
          {
            "name": "action",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "institutionId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "reportId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "version",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "packageId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "predecessor",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "digest",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "policy",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "outcome",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "signer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "authorityEpoch",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "signature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setSignatory",
    "inputs": [
      {
        "name": "institutionId",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "signer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "active",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setValidator",
    "inputs": [
      {
        "name": "validator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "active",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "signatories",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "active",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "epoch",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "usedNonces",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "validateAuthorization",
    "inputs": [
      {
        "name": "a",
        "type": "tuple",
        "internalType": "struct ReportEvidenceRegistry.Authorization",
        "components": [
          {
            "name": "action",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "institutionId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "reportId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "version",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "packageId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "predecessor",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "digest",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "policy",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "outcome",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "signer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "authorityEpoch",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "signature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "validatePublication",
    "inputs": [
      {
        "name": "a",
        "type": "tuple",
        "internalType": "struct ReportEvidenceRegistry.Authorization",
        "components": [
          {
            "name": "action",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "institutionId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "reportId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "version",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "packageId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "predecessor",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "digest",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "policy",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "outcome",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "signer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "authorityEpoch",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "signature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "v",
        "type": "tuple",
        "internalType": "struct ReportEvidenceRegistry.Authorization",
        "components": [
          {
            "name": "action",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "institutionId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "reportId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "version",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "packageId",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "predecessor",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "digest",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "policy",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "outcome",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "signer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "authorityEpoch",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "validatorSignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "validators",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "active",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "epoch",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "AdministratorAccepted",
    "inputs": [
      {
        "name": "institutionKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "previous",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "administrator",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AdministratorProposed",
    "inputs": [
      {
        "name": "institutionKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "administrator",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "successor",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EIP712DomainChanged",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EvidenceRecorded",
    "inputs": [
      {
        "name": "institutionKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "packageKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "authorization",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "action",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "digest",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "signer",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "InstitutionEnrolled",
    "inputs": [
      {
        "name": "institutionKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "institutionId",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "administrator",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ReportPublished",
    "inputs": [
      {
        "name": "institutionKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "packageKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "authorization",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "action",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "digest",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "signer",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "validatorAuthorization",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "validator",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SignatoryChanged",
    "inputs": [
      {
        "name": "institutionKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "signer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "active",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "epoch",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ValidatorChanged",
    "inputs": [
      {
        "name": "validator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "active",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "epoch",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyRecorded",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Expired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAuthorization",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidShortString",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Replayed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StringTooLong",
    "inputs": [
      {
        "name": "str",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  }
] as const;
