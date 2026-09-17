import { useState } from "react";
import { DocumentPreviewer } from "./DocumentPreviewer";
import { MetadataInspectorCard } from "./MetadataInspectorCard";
import { RawJsonTree } from "./RawJsonTree";
import { OnChainIntegrityBadge } from "./OnChainIntegrityBadge";

export function EvidenceInspectionResult({ cid, inspection }: { cid: string; inspection: any }) {
  const [activeAttachment, setActiveAttachment] = useState<any>(null);

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <OnChainIntegrityBadge cid={cid} onChainContext={inspection?.onChainContext} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 space-y-4">
          <DocumentPreviewer
            cid={activeAttachment?.cid || cid}
            fileName={activeAttachment?.name || "dokumen_bukti_zakat.pdf"}
            fileType={activeAttachment?.fileType || "application/pdf"}
          />
        </div>
        <div className="lg:col-span-5 space-y-6">
          <MetadataInspectorCard metadata={inspection?.data} onSelectAttachment={setActiveAttachment} />
        </div>
      </div>

      {inspection?.data && (
        <RawJsonTree data={inspection.data} title={`Raw JSON Tree Payload (CID: ${cid.slice(0, 12)}...)`} />
      )}
    </div>
  );
}
