import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
import { useAccount } from "wagmi";
import { getPublicClient } from "../../lib/web3Client";
import { GOVERNANCE_ROLES, ZAKAT_PROTOCOL_L1_ADDRESS, getApiBaseUrl } from "../../lib/contracts";
import { parseAbi } from "viem";

export type GovernancePersona = "AUTO" | "AMIL" | "DPS" | "AUDITOR" | "PUBLIC";

export interface GovernanceRoleInfo {
  roleHash: string;
  roleName: string;
  accountAddress: string;
  label: string;
}

interface RoleContextValue {
  persona: GovernancePersona;
  setPersona: (p: GovernancePersona) => void;
  connectedAddress?: string;
  isWalletConnected: boolean;
  detectedRoles: string[]; // e.g. ["DEFAULT_ADMIN_ROLE", "SHARIA_SUPERVISOR_ROLE", "AUDITOR_ROLE"]
  effectiveRole: "AMIL" | "DPS" | "AUDITOR" | "PUBLIC";
  canCreateProposal: boolean;
  canApproveDps: boolean;
  canExecuteBast: boolean;
  canAttestAudit: boolean;
  getRestrictionReason: (action: "create" | "approve" | "bast" | "audit") => string;
}

const defaultRoleValue: RoleContextValue = {
  persona: "AUTO",
  setPersona: () => {},
  connectedAddress: undefined,
  isWalletConnected: false,
  detectedRoles: [],
  effectiveRole: "PUBLIC",
  canCreateProposal: false,
  canApproveDps: false,
  canExecuteBast: false,
  canAttestAudit: false,
  getRestrictionReason: (action: "create" | "approve" | "bast" | "audit") => {
    switch (action) {
      case "create":
        return "Pengajuan usulan mustahik hanya dapat dilakukan oleh Amil Operasional BAZNAS/LAZ (DEFAULT_ADMIN_ROLE).";
      case "approve":
        return "Persetujuan kelayakan syariah hanya dapat disahkan oleh Dewan Pengawas Syariah (SHARIA_SUPERVISOR_ROLE).";
      case "bast":
        return "Eksekusi pencairan fisik & unggah BAST adalah kewenangan tim Amil di lapangan setelah disetujui DPS.";
      case "audit":
        return "Sertifikasi Opini WTP adalah hak independen Kantor Akuntan Publik (KAP) terdaftar (AUDITOR_ROLE).";
      default:
        return "Aksi dibatasi sesuai pembagian peran tata kelola syariah.";
    }
  },
};

const RoleContext = createContext<RoleContextValue>(defaultRoleValue);

const HAS_ROLE_ABI = parseAbi([
  "function hasRole(bytes32 role, address account) view returns (bool)",
]);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const [persona, setPersona] = useState<GovernancePersona>("AUTO");
  const [roleMembers, setRoleMembers] = useState<GovernanceRoleInfo[]>([]);
  const [onChainRoles, setOnChainRoles] = useState<string[]>([]);

  // 1. Fetch registered role members from backend
  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/governance/roles`);
        if (res.ok) {
          const json = await res.json();
          setRoleMembers(json.roles || []);
        }
      } catch (err) {
        console.warn("Failed to fetch governance roles from backend:", err);
      }
    };
    fetchRoles();
  }, [address]);

  // 2. Fetch live on-chain roles directly from Arbitrum contract
  useEffect(() => {
    if (!address) {
      setOnChainRoles([]);
      return;
    }

    let isMounted = true;
    const checkOnChain = async () => {
      try {
        const publicClient = getPublicClient();
        const roleChecks = [
          { name: "DEFAULT_ADMIN_ROLE", hash: GOVERNANCE_ROLES.DEFAULT_ADMIN_ROLE },
          { name: "SHARIA_SUPERVISOR_ROLE", hash: GOVERNANCE_ROLES.SHARIA_SUPERVISOR_ROLE },
          { name: "AUDITOR_ROLE", hash: GOVERNANCE_ROLES.AUDITOR_ROLE },
          { name: "RELAYER_ROLE", hash: GOVERNANCE_ROLES.RELAYER_ROLE },
        ];

        const results = await Promise.all(
          roleChecks.map(async (r) => {
            try {
              const has = await publicClient.readContract({
                address: ZAKAT_PROTOCOL_L1_ADDRESS,
                abi: HAS_ROLE_ABI,
                functionName: "hasRole",
                args: [r.hash as `0x${string}`, address],
              });
              return has ? r.name : null;
            } catch {
              return null;
            }
          })
        );

        if (isMounted) {
          setOnChainRoles(results.filter((r): r is string => Boolean(r)));
        }
      } catch (err) {
        console.warn("Direct on-chain role check failed:", err);
      }
    };

    checkOnChain();
    return () => {
      isMounted = false;
    };
  }, [address]);

  // Determine detected roles combining on-chain + backend records + deployer super-role
  const detectedRoles = useMemo(() => {
    if (!address) return [];
    const addrLower = address.toLowerCase();

    // Deployer 0x5e9b... retains all roles in testnet
    const isDeployer = addrLower === "0x5e9b652c4e8a013f6fab69f0b55377c408b59968".toLowerCase();

    const dbMatches = roleMembers
      .filter((r) => r.accountAddress?.toLowerCase() === addrLower)
      .map((r) => r.roleName);

    const merged = Array.from(new Set([...onChainRoles, ...dbMatches]));

    if (isDeployer) {
      return Array.from(
        new Set([
          ...merged,
          "DEFAULT_ADMIN_ROLE",
          "SHARIA_SUPERVISOR_ROLE",
          "AUDITOR_ROLE",
          "RELAYER_ROLE",
        ])
      );
    }
    return merged;
  }, [address, roleMembers, onChainRoles]);

  // Determine effective role based on persona simulator or wallet
  const effectiveRole = useMemo<"AMIL" | "DPS" | "AUDITOR" | "PUBLIC">(() => {
    if (persona === "AMIL") return "AMIL";
    if (persona === "DPS") return "DPS";
    if (persona === "AUDITOR") return "AUDITOR";
    if (persona === "PUBLIC") return "PUBLIC";

    // AUTO mode: infer from connected wallet
    if (!isConnected || !address) return "PUBLIC";
    if (detectedRoles.includes("DEFAULT_ADMIN_ROLE")) return "AMIL";
    if (detectedRoles.includes("SHARIA_SUPERVISOR_ROLE")) return "DPS";
    if (detectedRoles.includes("AUDITOR_ROLE")) return "AUDITOR";
    return "PUBLIC";
  }, [persona, isConnected, address, detectedRoles]);

  const canCreateProposal = effectiveRole === "AMIL";
  const canApproveDps = effectiveRole === "DPS";
  const canExecuteBast = effectiveRole === "AMIL";
  const canAttestAudit = effectiveRole === "AUDITOR";

  const getRestrictionReason = defaultRoleValue.getRestrictionReason;

  return (
    <RoleContext.Provider
      value={{
        persona,
        setPersona,
        connectedAddress: address,
        isWalletConnected: isConnected,
        detectedRoles,
        effectiveRole,
        canCreateProposal,
        canApproveDps,
        canExecuteBast,
        canAttestAudit,
        getRestrictionReason,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export function useGovernanceRole() {
  const context = useContext(RoleContext);
  return context || defaultRoleValue;
}
