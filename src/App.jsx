import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "./supabase";

const STORAGE_KEY = "sales_board_v1";

const DEFAULT_COLUMNS = [
  { id: "backlog", title: "Backlog" },
  { id: "contacted", title: "Contacted" },
  { id: "qualified", title: "Qualified" },
  { id: "proposal", title: "Proposal" },
  { id: "negotiation", title: "Negotiation" },
  { id: "won", title: "Won" },
  { id: "lost", title: "Lost" },
];

function uid() {
  return crypto?.randomUUID?.() ?? String(Date.now() + Math.random());
}

function getDueStatus(date) {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(date + "T00:00:00");
  if (due < today) return "overdue";
  if (due.getTime() === today.getTime()) return "today";
  return "future";
}

function formatDueDate(date) {
  if (!date) return "";
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ── localStorage helpers (offline fallback) ──────────────────── */

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLocal(cards) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ cards }));
}

/* ── Supabase ↔ App field mapping ─────────────────────────────── */

function fromRow(row) {
  return {
    id: row.id,
    title: row.title,
    columnId: row.column_id,
    value: row.value || "",
    phone: row.phone || "",
    email: row.email || "",
    nextAction: row.next_action || "",
    nextActionDue: row.next_action_due || "",
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(card) {
  return {
    id: card.id,
    title: card.title,
    column_id: card.columnId,
    value: card.value || "",
    phone: card.phone || "",
    email: card.email || "",
    next_action: card.nextAction || "",
    next_action_due: card.nextActionDue || "",
    notes: card.notes || "",
    created_at: card.createdAt,
    updated_at: card.updatedAt,
  };
}

/* ── App ──────────────────────────────────────────────────────── */

export default function App() {
  const [columns] = useState(DEFAULT_COLUMNS);
  const [cards, setCards] = useState(() => {
    const saved = loadLocal();
    return saved?.cards?.length ? saved.cards : [];
  });

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [syncStatus, setSyncStatus] = useState("syncing");

  const dragCardIdRef = useRef(null);

  /* ── Load from Supabase on mount ── */
  useEffect(() => {
    setSyncStatus("syncing");
    supabase
      .from("deals")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.error("Supabase load error:", error);
          setSyncStatus("offline");
          return;
        }
        const loaded = (data || []).map(fromRow);
        setCards(loaded);
        saveLocal(loaded);
        setSyncStatus("synced");
      });
  }, []);

  /* ── Persist to localStorage on every change ── */
  useEffect(() => {
    saveLocal(cards);
  }, [cards]);

  /* ── Derived state ── */
  const selected = useMemo(
    () => cards.find((c) => c.id === selectedId) ?? null,
    [cards, selectedId]
  );

  const filteredCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => {
      const blob =
        `${c.title} ${c.value} ${c.phone} ${c.email} ${c.nextAction} ${c.notes}`.toLowerCase();
      return blob.includes(q);
    });
  }, [cards, query]);

  const cardsByColumn = useMemo(() => {
    const map = new Map(columns.map((col) => [col.id, []]));
    for (const c of filteredCards) {
      if (!map.has(c.columnId)) map.set(c.columnId, []);
      map.get(c.columnId).push(c);
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    }
    return map;
  }, [filteredCards, columns]);

  const pipelineTotal = useMemo(() => {
    return cards
      .filter((c) => c.columnId !== "won" && c.columnId !== "lost")
      .reduce((sum, c) => {
        const n = parseFloat(String(c.value).replace(/[^0-9.]/g, ""));
        return sum + (isNaN(n) ? 0 : n);
      }, 0);
  }, [cards]);

  /* ── Supabase helper: fire-and-forget with status ── */
  const syncOp = useCallback(async (op) => {
    setSyncStatus("syncing");
    try {
      const { error } = await op();
      if (error) throw error;
      setSyncStatus("synced");
    } catch (err) {
      console.error("Sync error:", err);
      setSyncStatus("offline");
    }
  }, []);

  /* ── Actions ── */
  function addCard({ title }) {
    const now = new Date().toISOString();
    const newCard = {
      id: uid(),
      title: title.trim(),
      columnId: "backlog",
      value: "",
      phone: "",
      email: "",
      nextAction: "",
      nextActionDue: "",
      notes: "",
      createdAt: now,
      updatedAt: now,
    };
    setCards((prev) => [newCard, ...prev]);
    syncOp(() => supabase.from("deals").insert(toRow(newCard)));
  }

  const updateTimers = useRef({});

  const updateCard = useCallback(
    (id, patch) => {
      const now = new Date().toISOString();

      setCards((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, ...patch, updatedAt: now } : c
        )
      );

      clearTimeout(updateTimers.current[id]);
      updateTimers.current[id] = setTimeout(() => {
        setCards((prev) => {
          const latest = prev.find((c) => c.id === id);
          if (latest) {
            syncOp(() =>
              supabase.from("deals").update(toRow(latest)).eq("id", id)
            );
          }
          return prev;
        });
        delete updateTimers.current[id];
      }, 600);
    },
    [syncOp]
  );

  function deleteCard(id) {
    setSelectedId(null);
    setCards((prev) => prev.filter((c) => c.id !== id));
    syncOp(() => supabase.from("deals").delete().eq("id", id));
  }

  function onDragStart(e, cardId) {
    dragCardIdRef.current = cardId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", cardId);
  }

  function onDrop(e, columnId) {
    e.preventDefault();
    const cardId =
      e.dataTransfer.getData("text/plain") || dragCardIdRef.current;
    if (!cardId) return;
    updateCard(cardId, { columnId });
    dragCardIdRef.current = null;
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function resetBoard() {
    if (!confirm("Reset board? This will delete ALL cards.")) return;
    setSelectedId(null);
    const ids = cards.map((c) => c.id);
    setCards([]);
    if (ids.length > 0) {
      syncOp(() => supabase.from("deals").delete().in("id", ids));
    }
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(cards, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-board-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!Array.isArray(imported) || imported.length === 0) return;
        setCards(imported);
        syncOp(() =>
          supabase.from("deals").upsert(imported.map(toRow), { onConflict: "id" })
        );
      } catch {
        alert("Invalid file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  /* ── Render ── */
  return (
    <div className="wrap">
      <header className="header">
        <div className="titleBlock">
          <h1>Sales Board</h1>
          <div className="sub">
            Drag deals left &rarr; right &nbsp;
            {pipelineTotal > 0 && (
              <span className="pipeline">
                Pipeline: ${pipelineTotal.toLocaleString()}
              </span>
            )}
          </div>
        </div>

        <div className="controls">
          <input
            className="search"
            placeholder="Search deals\u2026"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <AddDeal onAdd={addCard} />

          <button
            className="btn ghost"
            onClick={handleExport}
            title="Export JSON backup"
          >
            Export
          </button>

          <label className="btn ghost importLabel" title="Import JSON backup">
            Import
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              style={{ display: "none" }}
            />
          </label>

          {syncStatus && (
            <span className={"syncBadge " + syncStatus}>
              {syncStatus === "syncing"
                ? "Syncing\u2026"
                : syncStatus === "synced"
                ? "Synced"
                : "Offline (local)"}
            </span>
          )}

          <button className="btn ghost" onClick={resetBoard}>
            Reset
          </button>
        </div>
      </header>

      <main className="board">
        {columns.map((col) => {
          const colCards = cardsByColumn.get(col.id) || [];
          return (
            <section
              key={col.id}
              className="column"
              onDrop={(e) => onDrop(e, col.id)}
              onDragOver={onDragOver}
            >
              <div className="colHeader">
                <div className="colTitle">{col.title}</div>
                <div className="colCount">{colCards.length}</div>
              </div>

              <div className="colBody">
                {colCards.map((card) => {
                  const dueStatus = getDueStatus(card.nextActionDue);
                  return (
                    <div
                      key={card.id}
                      className={
                        "card" + (selectedId === card.id ? " selected" : "")
                      }
                      draggable
                      onDragStart={(e) => onDragStart(e, card.id)}
                      onClick={() => setSelectedId(card.id)}
                      title="Drag to move. Click to edit."
                    >
                      <div className="cardTitle">{card.title}</div>

                      {card.phone && (
                        <div className="cardContact muted">
                          <span className="contactIcon">tel</span> {card.phone}
                        </div>
                      )}
                      {card.email && (
                        <div className="cardContact muted">
                          <span className="contactIcon">@</span> {card.email}
                        </div>
                      )}

                      {card.nextAction && (
                        <div className="cardMeta">
                          <span className="pill">Next</span>
                          <span className="muted">{card.nextAction}</span>
                        </div>
                      )}

                      {dueStatus && (
                        <div className="cardMeta">
                          <span className={"dueBadge " + dueStatus}>
                            {formatDueDate(card.nextActionDue)}
                          </span>
                        </div>
                      )}

                      {card.value && (
                        <div className="cardMeta">
                          <span className="pill">Value</span>
                          <span className="muted">{card.value}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        <aside className="panel">
          {selected ? (
            <Editor
              card={selected}
              columns={columns}
              onChange={(patch) => updateCard(selected.id, patch)}
              onDelete={() => deleteCard(selected.id)}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <div className="panelEmpty">
              <div className="panelTitle">Deal Details</div>
              <div className="muted">
                Click a card to edit.
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

/* ── AddDeal ─────────────────────────────────────────────────── */

function AddDeal({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd({ title });
    setTitle("");
    setOpen(false);
  }

  return (
    <div className="addWrap">
      <button className="btn" onClick={() => setOpen((v) => !v)}>
        + Deal
      </button>
      {open && (
        <form className="popover" onSubmit={submit}>
          <div className="popoverTitle">New deal</div>
          <input
            autoFocus
            placeholder="e.g., Doug @ Kaplan Construction"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="row">
            <button className="btn" type="submit">
              Add
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ── Editor ───────────────────────────────────────────────────── */

function Editor({ card, columns, onChange, onDelete, onClose }) {
  return (
    <div className="editor">
      <div className="editorHeader">
        <div className="panelTitle">Deal Details</div>
        <button className="btn ghost" onClick={onClose}>
          Close
        </button>
      </div>

      <label className="label">Title</label>
      <input
        value={card.title}
        onChange={(e) => onChange({ title: e.target.value })}
      />

      <label className="label">Phone</label>
      <input
        type="tel"
        placeholder="337-555-1234"
        value={card.phone || ""}
        onChange={(e) => onChange({ phone: e.target.value })}
      />

      <label className="label">Email</label>
      <input
        type="email"
        placeholder="name@company.com"
        value={card.email || ""}
        onChange={(e) => onChange({ email: e.target.value })}
      />

      <label className="label">Stage</label>
      <select
        value={card.columnId}
        onChange={(e) => onChange({ columnId: e.target.value })}
      >
        {columns.map((col) => (
          <option key={col.id} value={col.id}>
            {col.title}
          </option>
        ))}
      </select>

      <label className="label">Value (optional)</label>
      <input
        placeholder="$5,000 / $30k project / monthly retainer..."
        value={card.value || ""}
        onChange={(e) => onChange({ value: e.target.value })}
      />

      <label className="label">Next Action</label>
      <input
        placeholder="What is the next thing you need to do?"
        value={card.nextAction || ""}
        onChange={(e) => onChange({ nextAction: e.target.value })}
      />

      <label className="label">Due Date</label>
      <input
        type="date"
        value={card.nextActionDue || ""}
        onChange={(e) => onChange({ nextActionDue: e.target.value })}
      />

      <label className="label">Notes</label>
      <textarea
        rows={8}
        placeholder="Dump your notes here."
        value={card.notes || ""}
        onChange={(e) => onChange({ notes: e.target.value })}
      />

      <div className="row">
        <button className="btn danger" onClick={onDelete}>
          Delete deal
        </button>
      </div>

      <div className="muted small" style={{ marginTop: 12 }}>
        Created {new Date(card.createdAt).toLocaleDateString()} &middot; Updated{" "}
        {new Date(card.updatedAt).toLocaleDateString()}
      </div>
    </div>
  );
}
