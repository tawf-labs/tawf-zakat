import { useState } from "react";
import { Search } from "lucide-react";
import {
  money,
  statusLabel,
  type Campaign,
  type QueueRow,
  type QueueTask,
} from "./client";

export type QueueFocus = "top" | "operator" | "updates";
type QueueEntry = { row: QueueRow; task: QueueTask };
type View = "TASKS" | QueueTask["type"] | "ALL";

const PAGE = 40;
const taskLabel: Record<QueueTask["type"], string> = {
  PROPOSAL: "Review proposal",
  PUBLISH: "Siap terbit",
  REPORT: "Laporan realisasi",
};

/** Everything awaiting an operator, longest-waiting first so nothing is starved by newer work. */
export function queueTasks(rows: QueueRow[]): QueueEntry[] {
  return rows
    .flatMap((row) => row.tasks.map((task) => ({ row, task })))
    .sort((a, b) => a.task.since.localeCompare(b.task.since));
}
export const taskFocus = (task: QueueTask): QueueFocus =>
  task.type === "REPORT"
    ? "updates"
    : task.type === "PUBLISH"
      ? "operator"
      : "top";
export const awaitsOperator = (campaign: Campaign) =>
  ["SUBMITTED", "APPROVED"].includes(campaign.status) ||
  Boolean(campaign.updates?.some((update) => update.status === "SUBMITTED"));

function waiting(since: string) {
  const minutes = Math.max(0, (Date.now() - Date.parse(since)) / 60000);
  if (minutes < 60) return "menunggu < 1 jam";
  if (minutes < 1440) return `menunggu ${Math.floor(minutes / 60)} jam`;
  return `menunggu ${Math.floor(minutes / 1440)} hari`;
}
function taskDetail({ row, task }: QueueEntry) {
  if (task.type === "REPORT")
    return `${task.title}${task.usedAmount ? ` · ${money(task.usedAmount)}` : ""}`;
  if (task.type === "PUBLISH") return "Disetujui, belum diterbitkan";
  return row.version > 1 ? `Revisi ke-${row.version - 1}` : "Pengajuan baru";
}

export function OperatorQueue({
  rows,
  loading,
  selectedId,
  onOpen,
}: {
  rows: QueueRow[];
  loading: boolean;
  selectedId?: string;
  onOpen: (id: string, focus: QueueFocus) => void;
}) {
  const [view, setView] = useState<View>("TASKS");
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const tasks = queueTasks(rows);
  const count = (type: QueueTask["type"]) =>
    tasks.filter((entry) => entry.task.type === type).length;
  const term = search.trim().toLowerCase();
  const matches = (row: QueueRow, extra = "") =>
    !term ||
    `${row.title} ${row.organizer} ${extra}`.toLowerCase().includes(term);
  const shownTasks = tasks.filter(
    (entry) =>
      (view === "TASKS" || entry.task.type === view) &&
      matches(entry.row, entry.task.title),
  );
  const shownRows = rows
    .filter(
      (row) => (status === "ALL" || row.status === status) && matches(row),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const total = view === "ALL" ? shownRows.length : shownTasks.length;
  const statuses = [...new Set(rows.map((row) => row.status))];
  const tab = (key: View, label: string, amount: number) => (
    <button
      type="button"
      aria-pressed={view === key}
      onClick={() => {
        setView(key);
        setLimit(PAGE);
      }}
    >
      {label} <span>{amount}</span>
    </button>
  );
  return (
    <div className="cf-queue">
      <div
        className="cf-queue-tabs"
        role="group"
        aria-label="Saring antrean operator"
      >
        {tab("TASKS", "Perlu tindakan", tasks.length)}
        {tab("PROPOSAL", "Review", count("PROPOSAL"))}
        {tab("REPORT", "Laporan", count("REPORT"))}
        {tab("PUBLISH", "Siap terbit", count("PUBLISH"))}
        {tab("ALL", "Semua kampanye", rows.length)}
      </div>
      <label className="cf-search cf-queue-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={search}
          aria-label="Cari judul atau penggalang"
          placeholder="Cari judul atau penggalang"
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(PAGE);
          }}
        />
      </label>
      {view === "ALL" && (
        <select
          className="cf-queue-status"
          aria-label="Saring status kampanye"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setLimit(PAGE);
          }}
        >
          <option value="ALL">Semua status ({rows.length})</option>
          {statuses.map((value) => (
            <option key={value} value={value}>
              {statusLabel[value] || value} (
              {rows.filter((row) => row.status === value).length})
            </option>
          ))}
        </select>
      )}
      {!total && !loading && (
        <p className="cf-queue-empty">
          {term || (view === "ALL" && status !== "ALL")
            ? "Tidak ada yang cocok dengan pencarian ini."
            : view === "ALL"
              ? "Belum ada kampanye yang diajukan."
              : "Antrean kosong. Tidak ada yang menunggu tindakan."}
        </p>
      )}
      <div className="cf-queue-list">
        {view === "ALL"
          ? shownRows.slice(0, limit).map((row) => (
              <button
                key={row.id}
                disabled={loading}
                aria-pressed={selectedId === row.id}
                className="cf-list-item cf-queue-item"
                onClick={() => onOpen(row.id, "top")}
              >
                <div className="cf-queue-line">
                  <span className="cf-queue-type">
                    {statusLabel[row.status] || row.status}
                  </span>
                  {row.tasks.length > 0 && (
                    <span className="cf-queue-age">
                      {row.tasks.length} perlu tindakan
                    </span>
                  )}
                </div>
                <strong>{row.title}</strong>
                <span className="cf-queue-meta">{row.organizer}</span>
              </button>
            ))
          : shownTasks.slice(0, limit).map((entry) => (
              <button
                key={`${entry.row.id}-${entry.task.type}-${entry.task.updateId || ""}`}
                disabled={loading}
                aria-pressed={selectedId === entry.row.id}
                className="cf-list-item cf-queue-item"
                onClick={() => onOpen(entry.row.id, taskFocus(entry.task))}
              >
                <div className="cf-queue-line">
                  <span
                    className={`cf-queue-type cf-queue-${entry.task.type.toLowerCase()}`}
                  >
                    {taskLabel[entry.task.type]}
                  </span>
                  <span className="cf-queue-age">
                    {waiting(entry.task.since)}
                  </span>
                </div>
                <strong>{entry.row.title}</strong>
                <span className="cf-queue-meta">
                  {entry.row.organizer} · {taskDetail(entry)}
                </span>
              </button>
            ))}
      </div>
      {total > limit && (
        <button
          type="button"
          className="cf-text-button"
          onClick={() => setLimit(limit + PAGE)}
        >
          Tampilkan {Math.min(PAGE, total - limit)} berikutnya ({total - limit}{" "}
          lagi)
        </button>
      )}
    </div>
  );
}
