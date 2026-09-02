import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
import { useAccount } from "wagmi";

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

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const [persona, setPersona] = useState<GovernancePersona>("AUTO");
  const [roleMembers, setRoleMembers] = useState<GovernanceRoleInfo[]>([]);

  // Fetch registered on-chain role members from backend
  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const res = await fetch("http://localhost:3001/api/governance/roles");
        if (res.ok) {
          const json = await res.json();
          setRoleMembers(json.roles || []);
        }
      } catch (err) {
        console.warn("Failed to fetch governance roles:", err);
      }
    };
    fetchRoles();
  }, [address]);

  // Determine detected roles for connected wallet address
  const detectedRoles = useMemo(() => {
    if (!address) return [];
    const addrLower = address.toLowerCase();

    // The deployer address 0x5e9b... is default super-authority during testnet
    const isDeployer = addrLower === "0x5e9b652c4e8a013f6fab69f0b55377c408b59968".toLowerCase();

    const matches = roleMembers
      .filter((r) => r.accountAddress?.toLowerCase() === addrLower)
      .map((r) => r.roleName);

    if (isDeployer) {
      return Array.from(
        new Set([
          ...matches,
          "DEFAULT_ADMIN_ROLE",
          "SHARIA_SUPERVISOR_ROLE",
          "AUDITOR_ROLE",
          "RELAYER_ROLE",
        ])
      );
    }
    return matches;
  }, [address, roleMembers]);

  // Determine the effective role based on persona simulation or detected wallet
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

  // Permission flags based on strict Separation of Duties
  const canCreateProposal = effectiveRole === "AMIL";
  const canApproveDps = effectiveRole === "DPS";
  const canExecuteBast = effectiveRole === "AMIL";
  const canAttestAudit = effectiveRole === "AUDITOR";

  const getRestrictionReason = (action: "create" | "approve" | "bast" | "audit") => {
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
  };

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
  if (!context) {
    throw new Error("useGovernanceRole must be used within a RoleProvider");
  }
  return context;
}
