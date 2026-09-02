import React, { useState } from "react";
import { Copy, Check, Code2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface RawJsonTreeProps {
  data: any;
  title?: string;
}

export function RawJsonTree({ data, title = "Payload JSON IPFS Mentah" }: RawJsonTreeProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const jsonString = JSON.stringify(data, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    toast.success("JSON disalin ke clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-2xl border border-[#dbe7dd] bg-[#17332c] text-white overflow-hidden shadow-xs">
      <div className="flex items-center justify-between px-4 py-3 bg-[#143f34] border-b border-[#255246]">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-xs font-mono font-bold text-[#c4ed70] hover:text-white transition-colors cursor-pointer"
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <Code2 className="w-3.5 h-3.5" />
          <span>{title}</span>
        </button>

        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#1b765e] hover:bg-[#208b6f] text-white text-[11px] font-semibold transition-all cursor-pointer shadow-2xs"
        >
          {copied ? <Check className="w-3 h-3 text-[#c4ed70]" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? "Tersalin" : "Salin JSON"}</span>
        </button>
      </div>

      {expanded && (
        <div className="p-4 max-h-96 overflow-y-auto font-mono text-xs text-[#eaf3e8] leading-relaxed">
          <pre className="whitespace-pre-wrap break-all">{jsonString}</pre>
        </div>
      )}
    </div>
  );
}
