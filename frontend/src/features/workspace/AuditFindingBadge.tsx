import { Badge } from "../../components/ui/Badge";
import {
  AUDIT_FINDING_SCOPE_LABELS,
  AUDIT_FINDING_SEVERITY_LABELS,
  AUDIT_FINDING_STATUS_LABELS,
  type AuditFindingScope,
  type AuditFindingSeverity,
  type AuditFindingStatus,
} from "../../../../shared/audit-findings";

export function FindingStatusBadge({ status }: { status: AuditFindingStatus }) {
  const variantMap: Record<AuditFindingStatus, "warning" | "info" | "neutral" | "success"> = {
    OPEN: "warning",
    DITANGGAPI: "info",
    DALAM_PENELAAHAN: "info",
    DITINDAKLANJUTI: "neutral",
    DITUTUP_AUDITOR: "success",
  };

  return (
    <Badge variant={variantMap[status]}>
      {AUDIT_FINDING_STATUS_LABELS[status] || status}
    </Badge>
  );
}

export function FindingSeverityBadge({ severity }: { severity: AuditFindingSeverity }) {
  const variantMap: Record<AuditFindingSeverity, "info" | "neutral" | "warning" | "danger"> = {
    INFO: "info",
    CATATAN: "neutral",
    TEMUAN_RINGAN: "warning",
    TEMUAN_MATERIAL: "danger",
  };

  return (
    <Badge variant={variantMap[severity]}>
      {AUDIT_FINDING_SEVERITY_LABELS[severity] || severity}
    </Badge>
  );
}

export function FindingScopeBadge({ scope }: { scope: AuditFindingScope }) {
  return (
    <Badge variant="neutral">
      {AUDIT_FINDING_SCOPE_LABELS[scope] || scope}
    </Badge>
  );
}
