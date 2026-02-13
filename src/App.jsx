import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "./supabase";

const STORAGE_KEY = "sales_board_v1";

const DEFAULT_COLUMNS = [
  { id: "backlog", title: "Backlog", tip: "Potential contact. No outreach yet." },
  { id: "contacted", title: "Contacted", tip: "Outreach made. Awaiting response." },
  { id: "meetings", title: "Meetings", tip: "Time booked. Conversation pending." },
  { id: "qualified", title: "Qualified", tip: "Pain confirmed. Solution viable. Budget potential." },
  { id: "proposal", title: "Proposal", tip: "Scope + pricing delivered." },
  { id: "negotiation", title: "Negotiation", tip: "Terms being discussed. Decision pending." },
  { id: "won", title: "Won", tip: "Agreement reached." },
];

/* ── Color palette for category badges ────────────────────────── */

const CAT_COLORS = [
  { bg: "#eff8ff", fg: "#175cd3" },
  { bg: "#fdf2fa", fg: "#c11574" },
  { bg: "#ecfdf3", fg: "#027a48" },
  { bg: "#fff6ed", fg: "#c4320a" },
  { bg: "#f4f3ff", fg: "#5925dc" },
  { bg: "#fef3f2", fg: "#b42318" },
  { bg: "#f0f9ff", fg: "#026aa2" },
  { bg: "#fdf4ff", fg: "#7f56d9" },
  { bg: "#fffaeb", fg: "#b54708" },
  { bg: "#f8f9fc", fg: "#363f72" },
  { bg: "#edfcf2", fg: "#0e7849" },
  { bg: "#fef4e6", fg: "#a8520b" },
];

function catColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CAT_COLORS[Math.abs(hash) % CAT_COLORS.length];
}

function uid() {
  return crypto?.randomUUID?.() ?? String(Date.now() + Math.random());
}

function formatMoney(n) {
  if (n >= 1000000) {
    const m = n / 1000000;
    return "$" + (m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)) + "M";
  }
  if (n >= 1000) {
    const k = n / 1000;
    return "$" + (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + "k";
  }
  return "$" + n.toLocaleString();
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
    website: row.website || "",
    category: row.category || "",
    notes: row.notes || "",
    sortOrder: row.sort_order ?? 0,
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
    website: card.website || "",
    category: card.category || "",
    notes: card.notes || "",
    sort_order: card.sortOrder ?? 0,
    created_at: card.createdAt,
    updated_at: card.updatedAt,
  };
}

/* ── Category badge component ─────────────────────────────────── */

function CatBadge({ name }) {
  const c = catColor(name);
  return (
    <span
      className="catBadge"
      style={{ background: c.bg, color: c.fg }}
    >
      {name}
    </span>
  );
}

/* ── App ──────────────────────────────────────────────────────── */

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("sales");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (authLoading) return null;
  if (!session) return <Login />;

  return (
    <div>
      <nav className="appNav">
        <span className="appTitle">GrantOS</span>
        <div className="appTabs">
          <button
            className={"appTab" + (activeTab === "sales" ? " active" : "")}
            onClick={() => setActiveTab("sales")}
          >
            Sales
          </button>
          <button
            className={"appTab" + (activeTab === "execution" ? " active" : "")}
            onClick={() => setActiveTab("execution")}
          >
            Execution
          </button>
        </div>
        <button
          className="appSignOut"
          onClick={() => supabase.auth.signOut()}
        >
          Sign Out
        </button>
      </nav>
      {activeTab === "sales" ? <Board /> : <Execution />}
    </div>
  );
}

/* ── Board (authenticated) ───────────────────────────────────── */

function Board() {
  const [columns] = useState(DEFAULT_COLUMNS);
  const [cards, setCards] = useState(() => {
    const saved = loadLocal();
    return saved?.cards?.length ? saved.cards : [];
  });
  const [categories, setCategories] = useState([]);

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(null);
  const [syncStatus, setSyncStatus] = useState("syncing");
  const [mobileCol, setMobileCol] = useState("backlog");

  const dragCardIdRef = useRef(null);

  /* ── Load from Supabase on mount ── */
  useEffect(() => {
    setSyncStatus("syncing");

    Promise.all([
      supabase.from("deals").select("*").order("created_at", { ascending: false }),
      supabase.from("categories").select("name").order("name"),
    ]).then(([dealsRes, catsRes]) => {
      if (dealsRes.error) {
        console.error("Supabase load error:", dealsRes.error);
        setSyncStatus("offline");
        return;
      }
      const loaded = (dealsRes.data || []).map(fromRow);
      setCards(loaded);
      saveLocal(loaded);

      if (!catsRes.error && catsRes.data) {
        setCategories(catsRes.data.map((r) => r.name));
      }

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
    let result = cards;

    if (categoryFilter !== "All") {
      result = result.filter((c) => c.category === categoryFilter);
    }

    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter((c) => {
        const blob =
          `${c.title} ${c.value} ${c.phone} ${c.email} ${c.nextAction} ${c.website} ${c.category} ${c.notes}`.toLowerCase();
        return blob.includes(q);
      });
    }

    return result;
  }, [cards, query, categoryFilter]);

  const cardsByColumn = useMemo(() => {
    const map = new Map(columns.map((col) => [col.id, []]));
    for (const c of filteredCards) {
      if (!map.has(c.columnId)) map.set(c.columnId, []);
      map.get(c.columnId).push(c);
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }
    return map;
  }, [filteredCards, columns]);

  const pipelineTotal = useMemo(() => {
    return cards
      .filter((c) => c.columnId !== "won")
      .reduce((sum, c) => {
        const raw = String(c.value || "").trim().toLowerCase();
        const num = parseFloat(raw.replace(/[^0-9.]/g, ""));
        if (isNaN(num)) return sum;
        if (raw.includes("m")) return sum + num * 1000000;
        if (raw.includes("k")) return sum + num * 1000;
        return sum + num;
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

  /* ── Add category ── */
  function addCategory(name) {
    const trimmed = name.trim();
    if (!trimmed || categories.includes(trimmed)) return;
    setCategories((prev) => [...prev, trimmed].sort());
    supabase.from("categories").insert({ name: trimmed }).then(({ error }) => {
      if (error) console.error("Category save error:", error);
    });
  }

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
      website: "",
      category: "",
      notes: "",
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    };
    // New cards go to top — bump everything else in backlog down
    setCards((prev) => {
      const bumped = prev.map((c) =>
        c.columnId === "backlog" ? { ...c, sortOrder: (c.sortOrder ?? 0) + 1 } : c
      );
      return [newCard, ...bumped];
    });
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

  function onDropCard(e, targetCardId, position) {
    e.preventDefault();
    e.stopPropagation();
    const cardId =
      e.dataTransfer.getData("text/plain") || dragCardIdRef.current;
    if (!cardId || cardId === targetCardId) return;

    const targetCard = cards.find((c) => c.id === targetCardId);
    if (!targetCard) return;

    reorderCard(cardId, targetCard.columnId, targetCardId, position);
    dragCardIdRef.current = null;
  }

  function onDropColumn(e, columnId) {
    e.preventDefault();
    const cardId =
      e.dataTransfer.getData("text/plain") || dragCardIdRef.current;
    if (!cardId) return;

    // Dropped on empty area of column — put at end
    const colCards = (cardsByColumn.get(columnId) || []);
    const maxOrder = colCards.length > 0
      ? Math.max(...colCards.map((c) => c.sortOrder ?? 0)) + 1
      : 0;

    const now = new Date().toISOString();
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId
          ? { ...c, columnId, sortOrder: maxOrder, updatedAt: now }
          : c
      )
    );

    // Sync the moved card
    setTimeout(() => {
      setCards((prev) => {
        const latest = prev.find((c) => c.id === cardId);
        if (latest) {
          syncOp(() =>
            supabase.from("deals").update(toRow(latest)).eq("id", cardId)
          );
        }
        return prev;
      });
    }, 100);

    dragCardIdRef.current = null;
  }

  function reorderCard(cardId, targetColumnId, targetCardId, position) {
    const now = new Date().toISOString();

    setCards((prev) => {
      // Get cards in the target column, excluding the dragged card
      const colCards = prev
        .filter((c) => c.columnId === targetColumnId && c.id !== cardId)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

      // Find where the target card is
      const targetIdx = colCards.findIndex((c) => c.id === targetCardId);
      const insertIdx = position === "above" ? targetIdx : targetIdx + 1;

      // Insert the dragged card at the right position
      const draggedCard = prev.find((c) => c.id === cardId);
      if (!draggedCard) return prev;

      colCards.splice(insertIdx, 0, {
        ...draggedCard,
        columnId: targetColumnId,
        updatedAt: now,
      });

      // Reassign sort_order for all cards in this column
      const updates = new Map();
      colCards.forEach((c, i) => {
        updates.set(c.id, i);
      });

      const next = prev.map((c) => {
        if (updates.has(c.id)) {
          return {
            ...c,
            columnId: targetColumnId,
            sortOrder: updates.get(c.id),
            updatedAt: c.id === cardId ? now : c.updatedAt,
          };
        }
        return c;
      });

      // Batch sync all reordered cards in this column
      const toSync = next.filter(
        (c) => c.columnId === targetColumnId
      );
      Promise.all(
        toSync.map((c) =>
          supabase.from("deals").update({ sort_order: c.sortOrder, column_id: c.columnId, updated_at: c.updatedAt }).eq("id", c.id)
        )
      ).then(() => setSyncStatus("synced"))
        .catch(() => setSyncStatus("offline"));
      setSyncStatus("syncing");

      return next;
    });
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
                Pipeline: {formatMoney(pipelineTotal)}
              </span>
            )}
          </div>
        </div>

        <div className="controls">
          <input
            className="search"
            placeholder="Search deals..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <select
            className="filterSelect"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="All">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          <AddDeal onAdd={addCard} />

          {syncStatus && (
            <span className={"syncBadge " + syncStatus}>
              {syncStatus === "syncing"
                ? "Syncing..."
                : syncStatus === "synced"
                ? "Synced"
                : "Offline (local)"}
            </span>
          )}

          <OptionsMenu
            onExport={handleExport}
            onImport={handleImport}
            onReset={resetBoard}
          />
        </div>
      </header>

      <nav className="mobileTabBar">
        {columns.map((col) => {
          const count = (cardsByColumn.get(col.id) || []).length;
          return (
            <button
              key={col.id}
              className={"mobileTab" + (mobileCol === col.id ? " active" : "")}
              onClick={() => setMobileCol(col.id)}
            >
              {col.title} <span className="mobileTabCount">{count}</span>
            </button>
          );
        })}
      </nav>

      <main className="board">
        {columns.map((col) => {
          const colCards = cardsByColumn.get(col.id) || [];
          return (
            <section
              key={col.id}
              className={"column" + (col.id === mobileCol ? " mobileActive" : "")}
              onDrop={(e) => onDropColumn(e, col.id)}
              onDragOver={onDragOver}
            >
              <div className="colHeader">
                <div className="colTitleWrap">
                  <div className="colTitle">{col.title}</div>
                  {col.tip && <div className="colTip">{col.tip}</div>}
                </div>
                <div className="colCount">{colCards.length}</div>
              </div>

              <div className="colBody">
                {colCards.map((card) => {
                  const dueStatus = getDueStatus(card.nextActionDue);
                  return (
                    <div
                      key={card.id}
                      className={"cardWrap"}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        const mid = rect.top + rect.height / 2;
                        const pos = e.clientY < mid ? "above" : "below";
                        e.currentTarget.setAttribute("data-drop", pos);
                      }}
                      onDragLeave={(e) => {
                        e.currentTarget.removeAttribute("data-drop");
                      }}
                      onDrop={(e) => {
                        const pos = e.currentTarget.getAttribute("data-drop") || "below";
                        e.currentTarget.removeAttribute("data-drop");
                        onDropCard(e, card.id, pos);
                      }}
                    >
                      <div
                        className={
                          "card" + (selectedId === card.id ? " selected" : "")
                        }
                        draggable
                        onDragStart={(e) => onDragStart(e, card.id)}
                        onClick={() => setSelectedId(card.id)}
                        title="Drag to move. Click to edit."
                      >
                        <div className="cardTopRow">
                          <div className="cardTitle">{card.title}</div>
                          {card.category && <CatBadge name={card.category} />}
                        </div>

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
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        <aside className={"panel" + (selected ? " mobileOpen" : "")}>
          {selected ? (
            <Editor
              card={selected}
              columns={columns}
              categories={categories}
              onAddCategory={addCategory}
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

/* ── OptionsMenu ──────────────────────────────────────────────── */

function OptionsMenu({ onExport, onImport, onReset }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function close(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="optionsWrap" ref={ref}>
      <button className="btn ghost" onClick={() => setOpen((v) => !v)}>
        Options
      </button>
      {open && (
        <div className="optionsMenu">
          <button
            className="optionsItem"
            onClick={() => { onExport(); setOpen(false); }}
          >
            Export JSON
          </button>
          <label className="optionsItem importLabel">
            Import JSON
            <input
              type="file"
              accept=".json"
              onChange={(e) => { onImport(e); setOpen(false); }}
              style={{ display: "none" }}
            />
          </label>
          <button
            className="optionsItem danger"
            onClick={() => { onReset(); setOpen(false); }}
          >
            Reset Board
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Editor ───────────────────────────────────────────────────── */

function Editor({ card, columns, categories, onAddCategory, onChange, onDelete, onClose }) {
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState("");

  function submitNewCat(e) {
    e.preventDefault();
    if (!newCat.trim()) return;
    onAddCategory(newCat.trim());
    onChange({ category: newCat.trim() });
    setNewCat("");
    setAdding(false);
  }

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

      <label className="label">Category</label>
      <select
        value={card.category || ""}
        onChange={(e) => {
          if (e.target.value === "__add_new__") {
            setAdding(true);
          } else {
            onChange({ category: e.target.value });
          }
        }}
      >
        <option value="">None</option>
        {categories.map((cat) => (
          <option key={cat} value={cat}>{cat}</option>
        ))}
        <option value="__add_new__">+ Add new...</option>
      </select>
      {adding && (
        <form onSubmit={submitNewCat} className="catRow" style={{ marginTop: 6 }}>
          <input
            autoFocus
            placeholder="New category name"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn" type="submit" style={{ padding: "10px 12px" }}>
            Add
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => setAdding(false)}
            style={{ padding: "10px 12px" }}
          >
            Cancel
          </button>
        </form>
      )}

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

      <label className="label">Website (optional)</label>
      <input
        type="url"
        placeholder="https://company.com"
        value={card.website || ""}
        onChange={(e) => onChange({ website: e.target.value })}
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

/* ── Execution ────────────────────────────────────────────────── */

function Execution() {
  const [tasks, setTasks] = useState([]);
  const [targets, setTargets] = useState({});
  const [backlogCount, setBacklogCount] = useState(0);
  const [newTask, setNewTask] = useState({ captured: "", committed: "", execute: "" });
  const [quote, setQuote] = useState(null);
  const dragTaskRef = useRef(null);

  const SECTIONS = [
    { id: "captured", title: "Captured" },
    { id: "committed", title: "Committed" },
    { id: "execute", title: "Execute" },
  ];

  useEffect(() => {
    supabase
      .from("tasks")
      .select("*")
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        if (data) setTasks(data);
      });

    supabase
      .from("weekly_targets")
      .select("*")
      .then(({ data }) => {
        if (data) {
          const obj = {};
          data.forEach((r) => { obj[r.key] = r.value; });
          setTargets(obj);
        }
      });

    supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("column_id", "backlog")
      .then(({ count }) => { setBacklogCount(count || 0); });

    // Quote of the day (cached in localStorage)
    const today = new Date().toISOString().slice(0, 10);
    const cached = localStorage.getItem("qotd");
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.date === today) { setQuote(parsed); return; }
      } catch { /* ignore */ }
    }
    fetch("https://api.allorigins.win/get?url=" + encodeURIComponent("https://zenquotes.io/api/today"))
      .then((r) => r.json())
      .then((wrapper) => {
        const data = JSON.parse(wrapper.contents);
        if (data?.[0]?.q) {
          const q = { text: data[0].q, author: data[0].a, date: today };
          setQuote(q);
          localStorage.setItem("qotd", JSON.stringify(q));
        }
      })
      .catch(() => {});
  }, []);

  /* ── Derived: tasks grouped by section, sorted ── */
  const tasksBySection = useMemo(() => {
    const map = new Map(SECTIONS.map((s) => [s.id, []]));
    for (const t of tasks) {
      if (!map.has(t.section)) map.set(t.section, []);
      map.get(t.section).push(t);
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }
    return map;
  }, [tasks]);

  /* ── Add task ── */
  function addTask(section) {
    const title = newTask[section].trim();
    if (!title) return;
    const now = new Date().toISOString();
    const secTasks = tasksBySection.get(section) || [];
    const maxOrder = secTasks.length > 0
      ? Math.max(...secTasks.map((t) => t.sort_order ?? 0)) + 1
      : 0;
    const task = {
      id: uid(), title, section, status: "todo",
      sort_order: maxOrder, created_at: now, updated_at: now,
    };
    setTasks((prev) => [...prev, task]);
    setNewTask((prev) => ({ ...prev, [section]: "" }));
    supabase.from("tasks").insert(task);
  }

  /* ── Edit title ── */
  function updateTaskTitle(id, title) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  }

  function saveTaskTitle(id) {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === id);
      if (task) supabase.from("tasks").update({ title: task.title }).eq("id", id);
      return prev;
    });
  }

  /* ── Toggle done ── */
  function toggleTask(id) {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === id);
      if (!task) return prev;
      const newStatus = task.status === "done" ? "todo" : "done";
      supabase.from("tasks").update({ status: newStatus }).eq("id", id);
      return prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t));
    });
  }

  /* ── Delete ── */
  function deleteTask(id) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    supabase.from("tasks").delete().eq("id", id);
  }

  /* ── Drag-and-drop ── */
  function onTaskDragStart(e, taskId) {
    dragTaskRef.current = taskId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", taskId);
  }

  function onTaskDropOnTask(e, targetId, position) {
    e.preventDefault();
    e.stopPropagation();
    const taskId = e.dataTransfer.getData("text/plain") || dragTaskRef.current;
    if (!taskId || taskId === targetId) return;
    const target = tasks.find((t) => t.id === targetId);
    if (!target) return;
    reorderTask(taskId, target.section, targetId, position);
    dragTaskRef.current = null;
  }

  function onTaskDropOnSection(e, sectionId) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain") || dragTaskRef.current;
    if (!taskId) return;
    const secTasks = tasksBySection.get(sectionId) || [];
    const maxOrder = secTasks.length > 0
      ? Math.max(...secTasks.map((t) => t.sort_order ?? 0)) + 1
      : 0;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, section: sectionId, sort_order: maxOrder } : t
      )
    );
    setTimeout(() => {
      setTasks((prev) => {
        const latest = prev.find((t) => t.id === taskId);
        if (latest) {
          supabase.from("tasks").update({ section: latest.section, sort_order: latest.sort_order }).eq("id", taskId);
        }
        return prev;
      });
    }, 50);
    dragTaskRef.current = null;
  }

  function reorderTask(taskId, targetSection, targetId, position) {
    setTasks((prev) => {
      const colTasks = prev
        .filter((t) => t.section === targetSection && t.id !== taskId)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      const targetIdx = colTasks.findIndex((t) => t.id === targetId);
      const insertIdx = position === "above" ? targetIdx : targetIdx + 1;
      const dragged = prev.find((t) => t.id === taskId);
      if (!dragged) return prev;
      colTasks.splice(insertIdx, 0, { ...dragged, section: targetSection });

      const updates = new Map();
      colTasks.forEach((t, i) => updates.set(t.id, i));

      const next = prev.map((t) => {
        if (updates.has(t.id)) {
          return { ...t, section: targetSection, sort_order: updates.get(t.id) };
        }
        return t;
      });

      // Batch sync
      const toSync = next.filter((t) => t.section === targetSection);
      Promise.all(
        toSync.map((t) =>
          supabase.from("tasks").update({ sort_order: t.sort_order, section: t.section }).eq("id", t.id)
        )
      );

      return next;
    });
  }

  /* ── Targets ── */
  function updateTarget(key, delta) {
    const newVal = Math.max(0, (targets[key] || 0) + delta);
    setTargets((prev) => ({ ...prev, [key]: newVal }));
    supabase.from("weekly_targets").update({ value: newVal }).eq("key", key);
  }

  function resetTargets() {
    if (!confirm("Reset all weekly counters to 0?")) return;
    setTargets({ leads_added: 0, meetings_booked: 0, proposals_sent: 0, federal_proposals: 0 });
    ["leads_added", "meetings_booked", "proposals_sent", "federal_proposals"].forEach(
      (key) => supabase.from("weekly_targets").update({ value: 0 }).eq("key", key)
    );
  }

  const TARGETS = [
    { key: "backlog", label: "Backlog", goal: 500, value: backlogCount, auto: true },
    { key: "leads_added", label: "Leads", goal: 25 },
    { key: "meetings_booked", label: "Meetings", goal: 8 },
    { key: "proposals_sent", label: "Proposals", goal: 3 },
    { key: "federal_proposals", label: "Federal", goal: 2 },
  ];

  return (
    <div className="execWrap">
      <div className="execMain">
      <div className="execTargets">
        <div className="execTargetsHeader">
          <span className="execTargetsTitle">Weekly Targets</span>
          <button
            className="btn ghost"
            onClick={resetTargets}
            style={{ fontSize: 11, padding: "4px 10px" }}
          >
            Reset
          </button>
        </div>
        <div className="execTargetCards">
          {TARGETS.map((t) => {
            const val = t.auto ? t.value : targets[t.key] || 0;
            return (
              <div key={t.key} className="execTargetCard">
                <div className="execTargetValue">
                  {val}
                  <span className="execTargetGoal">/{t.goal}</span>
                </div>
                <div className="execTargetLabel">{t.label}</div>
                {!t.auto && (
                  <div className="execTargetBtns">
                    <button onClick={() => updateTarget(t.key, -1)}>−</button>
                    <button onClick={() => updateTarget(t.key, 1)}>+</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="execGrid">
        {SECTIONS.map((sec) => {
          const secTasks = tasksBySection.get(sec.id) || [];
          const todoCount = secTasks.filter((t) => t.status !== "done").length;
          return (
            <section
              key={sec.id}
              className="execCol"
              onDrop={(e) => onTaskDropOnSection(e, sec.id)}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
            >
              <div className="execColHeader">
                <span className="execColTitle">{sec.title}</span>
                <span className="colCount">{todoCount}</span>
              </div>
              <div className="execTaskList">
                {secTasks.map((task) => (
                  <div
                    key={task.id}
                    className="execTaskWrap"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const mid = rect.top + rect.height / 2;
                      e.currentTarget.setAttribute("data-drop", e.clientY < mid ? "above" : "below");
                    }}
                    onDragLeave={(e) => e.currentTarget.removeAttribute("data-drop")}
                    onDrop={(e) => {
                      const pos = e.currentTarget.getAttribute("data-drop") || "below";
                      e.currentTarget.removeAttribute("data-drop");
                      onTaskDropOnTask(e, task.id, pos);
                    }}
                  >
                    <div
                      className={"execTask" + (task.status === "done" ? " done" : "")}
                      draggable
                      onDragStart={(e) => onTaskDragStart(e, task.id)}
                    >
                      <input
                        type="checkbox"
                        checked={task.status === "done"}
                        onChange={() => toggleTask(task.id)}
                        className="execCheck"
                      />
                      <input
                        className="execTaskInput"
                        value={task.title}
                        onChange={(e) => updateTaskTitle(task.id, e.target.value)}
                        onBlur={() => saveTaskTitle(task.id)}
                      />
                      <button
                        className="execTaskDel"
                        onClick={() => deleteTask(task.id)}
                        title="Delete"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                ))}
                <form
                  className="execAddForm"
                  onSubmit={(e) => { e.preventDefault(); addTask(sec.id); }}
                >
                  <input
                    className="execAddInput"
                    placeholder="Add task..."
                    value={newTask[sec.id]}
                    onChange={(e) =>
                      setNewTask((prev) => ({ ...prev, [sec.id]: e.target.value }))
                    }
                  />
                </form>
              </div>
            </section>
          );
        })}
      </div>
      </div>

      <aside className="execQuote">
        {quote ? (
          <>
            <div className="execQuoteText">&ldquo;{quote.text}&rdquo;</div>
            <div className="execQuoteAuthor">&mdash; {quote.author}</div>
          </>
        ) : (
          <div className="muted small">Loading quote...</div>
        )}
      </aside>
    </div>
  );
}

/* ── Login ────────────────────────────────────────────────────── */

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
  }

  return (
    <div className="loginWrap">
      <form className="loginBox" onSubmit={handleSubmit}>
        <h1>Sales Board</h1>
        <p className="muted" style={{ textAlign: "center" }}>Sign in to continue</p>
        {error && <div className="loginError">{error}</div>}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
