import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, client } from "./api";
import {
  formatLong,
  formatShort,
  groupTasks,
  isTaskOverdue,
  periodLabel,
  periodRange,
  shiftDate,
  sortTasks,
  targetLabel,
  todayInIndia,
} from "./date";
import type { DashboardResponse, Habit, Period, PlanType, Priority, Task, TaskInput } from "./types";

const KEY_STORAGE = "daymark:access-key";

function App() {
  const [accessKey, setAccessKey] = useState(() => localStorage.getItem(KEY_STORAGE) ?? "");
  const [selectedDate, setSelectedDate] = useState(todayInIndia);
  const [period, setPeriod] = useState<Period>("day");
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(Boolean(accessKey));
  const [error, setError] = useState("");
  const [mutationError, setMutationError] = useState("");

  const load = useCallback(async () => {
    if (!accessKey) return;
    setLoading(true);
    setError("");
    try {
      setDashboard(await client.dashboard(accessKey, selectedDate, period));
    } catch (reason) {
      const apiError = reason as ApiError;
      setError(apiError.message);
      if (apiError.status === 401) setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, [accessKey, selectedDate, period]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const unlock = (key: string) => {
    localStorage.setItem(KEY_STORAGE, key);
    setAccessKey(key);
  };

  const lock = () => {
    localStorage.removeItem(KEY_STORAGE);
    setAccessKey("");
    setDashboard(null);
    setError("");
  };

  const mutate = useCallback(
    async <T,>(optimistic: () => void, action: () => Promise<T>, reconcile?: (value: T) => void) => {
      const before = dashboard;
      setMutationError("");
      optimistic();
      try {
        const value = await action();
        reconcile?.(value);
        return value;
      } catch (reason) {
        setDashboard(before);
        setMutationError((reason as Error).message);
        throw reason;
      }
    },
    [dashboard],
  );

  const createTask = useCallback(
    async (input: TaskInput) => {
      setMutationError("");
      try {
        const response = await client.createTask(accessKey, input);
        const referenceDate = period === "day" ? selectedDate : periodRange(selectedDate, period).start;
        const task = { ...response, overdue: isTaskOverdue(response, referenceDate) };
        setDashboard((value) => (value ? { ...value, tasks: sortTasks([...value.tasks, task]) } : value));
        return task;
      } catch (reason) {
        setMutationError((reason as Error).message);
        throw reason;
      }
    },
    [accessKey, period, selectedDate],
  );

  const updateTask = useCallback(
    async (task: Task, patch: Partial<TaskInput & { status: "Open" | "Done" }>) => {
      const optimisticBase = {
        ...task,
        ...patch,
        completedAt: patch.status === "Done" ? new Date().toISOString() : patch.status === "Open" ? null : task.completedAt,
      };
      const referenceDate = period === "day" ? selectedDate : periodRange(selectedDate, period).start;
      const optimisticTask = { ...optimisticBase, overdue: isTaskOverdue(optimisticBase, referenceDate) };
      await mutate(
        () =>
          setDashboard((value) =>
            value
              ? { ...value, tasks: sortTasks(value.tasks.map((item) => (item.id === task.id ? optimisticTask : item))) }
              : value,
          ),
        () => client.updateTask(accessKey, task.id, patch),
        (response) => {
          const saved = { ...response, overdue: isTaskOverdue(response, referenceDate) };
          setDashboard((value) =>
            value
              ? { ...value, tasks: sortTasks(value.tasks.map((item) => (item.id === task.id ? saved : item))) }
              : value,
          );
        },
      );
      if (patch.status !== undefined || patch.dueDate !== undefined || patch.planType !== undefined) await load();
    },
    [accessKey, load, mutate, period, selectedDate],
  );

  const deleteTask = useCallback(
    async (task: Task) => {
      await mutate(
        () =>
          setDashboard((value) =>
            value ? { ...value, tasks: value.tasks.filter((item) => item.id !== task.id) } : value,
          ),
        () => client.deleteTask(accessKey, task.id),
      );
    },
    [accessKey, mutate],
  );

  const createHabit = useCallback(
    async (name: string) => {
      setMutationError("");
      try {
        const habit = await client.createHabit(accessKey, { name });
        setDashboard((value) => (value ? { ...value, habits: [...value.habits, habit] } : value));
        return habit;
      } catch (reason) {
        setMutationError((reason as Error).message);
        throw reason;
      }
    },
    [accessKey],
  );

  const toggleHabit = useCallback(
    async (habit: Habit, completed: boolean) => {
      await mutate(
        () =>
          setDashboard((value) =>
            value
              ? {
                  ...value,
                  habits: value.habits.map((item) =>
                    item.id === habit.id
                      ? { ...item, completed, streak: Math.max(0, item.streak + (completed ? 1 : -1)) }
                      : item,
                  ),
                }
              : value,
          ),
        () => client.checkHabit(accessKey, habit.id, selectedDate, completed),
        (saved) =>
          setDashboard((value) =>
            value
              ? { ...value, habits: value.habits.map((item) => (item.id === habit.id ? saved : item)) }
              : value,
          ),
      );
    },
    [accessKey, mutate, selectedDate],
  );

  const deleteHabit = useCallback(
    async (habit: Habit) => {
      await mutate(
        () =>
          setDashboard((value) =>
            value ? { ...value, habits: value.habits.filter((item) => item.id !== habit.id) } : value,
          ),
        () => client.deleteHabit(accessKey, habit.id),
      );
    },
    [accessKey, mutate],
  );

  const saveJournal = useCallback(
    async (text: string) => client.saveJournal(accessKey, selectedDate, text),
    [accessKey, selectedDate],
  );

  useWebMcp({ dashboard, createTask, toggleHabit, saveJournal, selectedDate });

  if (!accessKey || (error && !dashboard && !loading)) {
    return <Unlock onUnlock={unlock} error={error} />;
  }

  const move = (direction: number) => setSelectedDate((date) => shiftDate(date, direction, period));
  const dailyTasks = dashboard?.tasks.filter((task) => task.planType === "Daily") ?? [];
  const periodGoals = dashboard?.tasks.filter((task) => task.planType !== "Daily") ?? [];
  const visibleGoalType: PlanType = period === "week" ? "Weekly" : "Monthly";
  const visibleGoals = dashboard?.tasks.filter((task) => task.planType === visibleGoalType) ?? [];
  const referenceDate = period === "day" ? selectedDate : dashboard?.range.start ?? selectedDate;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => { setPeriod("day"); setSelectedDate(todayInIndia()); }}>
          <span className="brand-mark" aria-hidden="true">✓</span>
          <span>Daymark</span>
        </button>
        <nav className="period-tabs" aria-label="Planner period">
          {(["day", "week", "month"] as Period[]).map((item) => (
            <button
              className={period === item ? "active" : ""}
              key={item}
              type="button"
              onClick={() => setPeriod(item)}
            >
              {item === "day" ? "Today" : item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button className="icon-button" type="button" onClick={() => void load()} aria-label="Refresh data">↻</button>
          <button className="text-button" type="button" onClick={lock}>Lock</button>
        </div>
      </header>

      <main>
        <section className="datebar" aria-label="Date navigation">
          <button className="icon-button" type="button" onClick={() => move(-1)} aria-label={`Previous ${period}`}>←</button>
          <div>
            <p className="eyebrow">{period === "day" ? "Your day" : `${period} plan`}</p>
            <h1>{periodLabel(selectedDate, period)}</h1>
          </div>
          <button className="icon-button" type="button" onClick={() => move(1)} aria-label={`Next ${period}`}>→</button>
          {selectedDate !== todayInIndia() && (
            <button className="today-button" type="button" onClick={() => setSelectedDate(todayInIndia())}>Today</button>
          )}
          <span className="sync-label" aria-live="polite">
            {loading ? "Syncing…" : dashboard ? `Synced ${formatSyncTime(dashboard.syncedAt)}` : ""}
          </span>
        </section>

        {mutationError && (
          <div className="notice error-notice" role="alert">
            {mutationError} <button type="button" onClick={() => { setMutationError(""); void load(); }}>Retry</button>
          </div>
        )}
        {error && dashboard && <div className="notice error-notice" role="alert">{error}</div>}

        {loading && !dashboard ? (
          <LoadingState />
        ) : dashboard && period === "day" ? (
          <div className="day-grid">
            <section className="panel task-panel">
              <PanelHeading title="Tasks" meta={`${dailyTasks.filter((task) => task.status === "Open").length} open`} />
              <TaskComposer defaultDate={selectedDate} planType="Daily" onCreate={createTask} />
              <TaskList tasks={dailyTasks} referenceDate={selectedDate} onUpdate={updateTask} onDelete={deleteTask} />
            </section>

            <aside className="side-column">
              <section className="panel period-goals-panel">
                <PanelHeading title="Period goals" meta={`${periodGoals.filter((task) => task.status === "Open").length} open`} />
                <TaskList
                  tasks={periodGoals}
                  referenceDate={selectedDate}
                  onUpdate={updateTask}
                  onDelete={deleteTask}
                  emptyTitle="No period goals"
                  emptyDetail="Add one from the Week or Month view."
                />
              </section>
              <section className="panel">
                <PanelHeading
                  title="Habits"
                  meta={`${dashboard.habits.filter((habit) => habit.completed).length}/${dashboard.habits.length}`}
                />
                <HabitList
                  habits={dashboard.habits}
                  onCreate={createHabit}
                  onToggle={toggleHabit}
                  onDelete={deleteHabit}
                />
              </section>
              <section className="panel journal-panel">
                <PanelHeading title="Journal" meta={formatShort(selectedDate)} />
                <JournalEditor
                  key={selectedDate}
                  date={selectedDate}
                  initialText={dashboard.journal?.text ?? ""}
                  onSave={saveJournal}
                />
              </section>
            </aside>
          </div>
        ) : dashboard ? (
          <div className="planning-stack">
            <section className="panel">
              <PanelHeading title={`${visibleGoalType} goals`} meta={`${visibleGoals.filter((task) => task.status === "Open").length} open`} />
              <TaskComposer defaultDate={selectedDate} planType={visibleGoalType} onCreate={createTask} />
              <TaskList
                tasks={visibleGoals}
                referenceDate={referenceDate}
                onUpdate={updateTask}
                onDelete={deleteTask}
                emptyTitle={`No ${visibleGoalType.toLowerCase()} goals`}
                emptyDetail={`Add one for this ${period}.`}
              />
            </section>
            <section className="panel">
              <PanelHeading title="Scheduled tasks" meta={`${dailyTasks.length} tasks`} />
              <TaskComposer defaultDate={selectedDate} planType="Daily" onCreate={createTask} />
              <GroupedTaskList tasks={dailyTasks} referenceDate={referenceDate} onUpdate={updateTask} onDelete={deleteTask} />
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function Unlock({ onUnlock, error }: { onUnlock: (key: string) => void; error: string }) {
  const [value, setValue] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const key = value.trim();
    if (key) onUnlock(key);
  };
  return (
    <main className="unlock-page">
      <section className="unlock-panel">
        <span className="brand-mark large" aria-hidden="true">✓</span>
        <p className="eyebrow">Personal day tracker</p>
        <h1>Welcome to Daymark</h1>
        <p className="unlock-copy">Enter your private access key to open your tasks, habits, and journal.</p>
        <form onSubmit={submit}>
          <label htmlFor="access-key">Access key</label>
          <input
            id="access-key"
            type="password"
            autoComplete="current-password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoFocus
          />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit">Unlock planner</button>
        </form>
        <p className="privacy-note">Saved only in this browser. Use Lock to remove it.</p>
      </section>
    </main>
  );
}

function PanelHeading({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="panel-heading">
      <h2>{title}</h2>
      <span>{meta}</span>
    </div>
  );
}

function TaskComposer({ defaultDate, planType, onCreate }: { defaultDate: string; planType: PlanType; onCreate: (input: TaskInput) => Promise<Task> }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(defaultDate);
  const [priority, setPriority] = useState<Priority>("Medium");
  const [saving, setSaving] = useState(false);
  useEffect(() => setDueDate(defaultDate), [defaultDate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onCreate({ title: title.trim(), dueDate, priority, planType });
      setTitle("");
    } catch {
      // The page-level notice owns the error message.
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={`task-composer ${planType !== "Daily" ? "goal-composer" : ""}`} onSubmit={submit}>
      <label className="sr-only" htmlFor={`new-${planType}`}>New {planType.toLowerCase()} {planType === "Daily" ? "task" : "goal"}</label>
      <input
        id={`new-${planType}`}
        maxLength={200}
        placeholder={planType === "Daily" ? "Add a task…" : `Add a ${planType.toLowerCase()} goal…`}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      {planType === "Daily" && <>
        <label className="sr-only" htmlFor={`new-${planType}-date`}>Due date</label>
        <input id={`new-${planType}-date`} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
      </>}
      <label className="sr-only" htmlFor={`new-${planType}-priority`}>Priority</label>
      <select id={`new-${planType}-priority`} value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
        <option>High</option><option>Medium</option><option>Low</option>
      </select>
      <button className="add-button" type="submit" disabled={saving || !title.trim()} aria-label={`Add ${planType === "Daily" ? "task" : `${planType.toLowerCase()} goal`}`}>
        {saving ? "…" : "+"}
      </button>
    </form>
  );
}

interface TaskListProps {
  tasks: Task[];
  referenceDate: string;
  onUpdate: (task: Task, patch: Partial<TaskInput & { status: "Open" | "Done" }>) => Promise<void>;
  onDelete: (task: Task) => Promise<void>;
  emptyTitle?: string;
  emptyDetail?: string;
}

function TaskList({ tasks, referenceDate, onUpdate, onDelete, emptyTitle = "A clear day", emptyDetail = "Add the first task you want to move forward." }: TaskListProps) {
  if (!tasks.length) return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  return <div className="task-list">{sortTasks(tasks).map((task) => <TaskRow key={task.id} task={task} referenceDate={referenceDate} onUpdate={onUpdate} onDelete={onDelete} />)}</div>;
}

function GroupedTaskList(props: TaskListProps) {
  if (!props.tasks.length) return <EmptyState title="Nothing scheduled" detail="Add a task and give it a date." />;
  return (
    <div className="task-groups">
      {groupTasks(props.tasks).map(([date, tasks]) => (
        <section className="task-group" key={date}>
          <h3 className={date === "overdue" ? "overdue-heading" : ""}>{date === "overdue" ? "Carry-over" : formatLong(date)}</h3>
          <div className="task-list">{tasks.map((task) => <TaskRow key={task.id} task={task} {...props} />)}</div>
        </section>
      ))}
    </div>
  );
}

function TaskRow({ task, referenceDate, onUpdate, onDelete }: { task: Task } & Omit<TaskListProps, "tasks" | "emptyTitle" | "emptyDetail">) {
  const done = task.status === "Done";
  return (
    <div className={`task-row ${done ? "done" : ""}`}>
      <button
        className="check-button"
        type="button"
        aria-label={done ? `Mark ${task.title} open` : `Complete ${task.title}`}
        aria-pressed={done}
        onClick={() => void onUpdate(task, { status: done ? "Open" : "Done" })}
      >
        {done ? "✓" : ""}
      </button>
      <div className="task-copy">
        <span className="task-title">{task.title}</span>
        <span className={`task-date ${task.overdue && !done ? "overdue" : ""}`}>
          {task.planType === "Daily"
            ? task.dueDate === referenceDate ? "Today" : formatShort(task.dueDate)
            : `${task.planType} · ${targetLabel(task.dueDate, task.planType)}`}
          {task.overdue && !done ? " · overdue" : ""}
        </span>
      </div>
      <select
        className={`priority-select priority-${task.priority.toLowerCase()}`}
        aria-label={`Priority for ${task.title}`}
        value={task.priority}
        onChange={(event) => void onUpdate(task, { priority: event.target.value as Priority })}
      >
        <option>High</option><option>Medium</option><option>Low</option>
      </select>
      <input
        className="row-date"
        aria-label={`${task.planType === "Daily" ? "Due date" : `Target ${task.planType.toLowerCase().replace("ly", "")}`} for ${task.title}`}
        type="date"
        value={task.dueDate}
        onChange={(event) => void onUpdate(task, { dueDate: event.target.value, planType: task.planType })}
      />
      <button className="delete-button" type="button" onClick={() => void onDelete(task)} aria-label={`Archive ${task.title}`}>×</button>
    </div>
  );
}

function HabitList({ habits, onCreate, onToggle, onDelete }: { habits: Habit[]; onCreate: (name: string) => Promise<Habit>; onToggle: (habit: Habit, completed: boolean) => Promise<void>; onDelete: (habit: Habit) => Promise<void> }) {
  const [name, setName] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await onCreate(name.trim());
      setName("");
    } catch {
      // The page-level notice owns the error message.
    }
  };
  return (
    <>
      <div className="habit-list">
        {habits.map((habit) => (
          <div className="habit-row" key={habit.id}>
            <button className="habit-toggle" type="button" aria-pressed={habit.completed} onClick={() => void onToggle(habit, !habit.completed)}>
              <span className="habit-check" aria-hidden="true">{habit.completed ? "✓" : ""}</span>
              <span>{habit.name}</span>
            </button>
            <span className="streak">{habit.streak > 0 ? `${habit.streak} day${habit.streak === 1 ? "" : "s"}` : "Start today"}</span>
            <button className="delete-button" type="button" onClick={() => void onDelete(habit)} aria-label={`Archive ${habit.name}`}>×</button>
          </div>
        ))}
        {!habits.length && <EmptyState title="No habits yet" detail="Choose one small thing worth repeating." />}
      </div>
      <form className="habit-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="new-habit">New habit</label>
        <input id="new-habit" maxLength={100} placeholder="Add a daily habit…" value={name} onChange={(event) => setName(event.target.value)} />
        <button className="add-button" type="submit" disabled={!name.trim()} aria-label="Add habit">+</button>
      </form>
    </>
  );
}

function JournalEditor({ date, initialText, onSave }: { date: string; initialText: string; onSave: (text: string) => Promise<{ lastSavedAt: string }> }) {
  const draftKey = `daymark:draft:${date}`;
  const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? initialText);
  const [savedText, setSavedText] = useState(initialText);
  const [status, setStatus] = useState<"saved" | "unsaved" | "saving" | "error">(text === initialText ? "saved" : "unsaved");
  const timer = useRef<number | null>(null);

  const save = useCallback(async (value: string) => {
    if (value === savedText) return;
    setStatus("saving");
    try {
      await onSave(value);
      setSavedText(value);
      localStorage.removeItem(draftKey);
      setStatus("saved");
    } catch {
      localStorage.setItem(draftKey, value);
      setStatus("error");
    }
  }, [draftKey, onSave, savedText]);

  useEffect(() => {
    if (text === savedText) return;
    localStorage.setItem(draftKey, text);
    setStatus("unsaved");
    timer.current = window.setTimeout(() => void save(text), 1000);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [draftKey, save, savedText, text]);

  return (
    <div className="journal-editor">
      <textarea
        aria-label={`Journal for ${formatLong(date)}`}
        maxLength={10000}
        placeholder="What is on your mind today?"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => void save(text)}
      />
      <div className={`save-status status-${status}`} aria-live="polite">
        {status === "saving" ? "Saving…" : status === "unsaved" ? "Unsaved changes" : status === "error" ? "Not saved — will retry" : "Saved"}
      </div>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><strong>{title}</strong><span>{detail}</span></div>;
}

function LoadingState() {
  return <div className="loading-state" aria-label="Loading planner"><span /><span /><span /></div>;
}

function formatSyncTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

interface WebMcpContext {
  registerTool: (tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: object;
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
    execute: (input: Record<string, unknown>) => Promise<unknown>;
  }, options: { signal: AbortSignal }) => void | Promise<void>;
}

function useWebMcp({ dashboard, createTask, toggleHabit, saveJournal, selectedDate }: {
  dashboard: DashboardResponse | null;
  createTask: (input: TaskInput) => Promise<Task>;
  toggleHabit: (habit: Habit, completed: boolean) => Promise<void>;
  saveJournal: (text: string) => Promise<{ lastSavedAt: string }>;
  selectedDate: string;
}) {
  useEffect(() => {
    if (!dashboard) return;
    const context = (document as Document & { modelContext?: WebMcpContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Parameters<WebMcpContext["registerTool"]>[0]) => {
      void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined);
    };
    register({
      name: "create_task",
      title: "Create task",
      description: "Create a task in the visible personal planner.",
      inputSchema: { type: "object", properties: { title: { type: "string" }, dueDate: { type: "string", format: "date" }, priority: { enum: ["High", "Medium", "Low"] }, planType: { enum: ["Daily", "Weekly", "Monthly"] } }, required: ["title", "dueDate", "priority", "planType"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input) => createTask({ title: String(input.title), dueDate: String(input.dueDate), priority: input.priority as Priority, planType: input.planType as PlanType }),
    });
    register({
      name: "set_habit_completion",
      title: "Set habit completion",
      description: "Mark one visible daily habit complete or incomplete for the selected date.",
      inputSchema: { type: "object", properties: { habitId: { type: "string" }, completed: { type: "boolean" } }, required: ["habitId", "completed"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input) => {
        const habit = dashboard?.habits.find((item) => item.id === input.habitId);
        if (!habit) throw new Error("Habit not found in the visible day.");
        await toggleHabit(habit, Boolean(input.completed));
        return { id: habit.id, date: selectedDate, completed: Boolean(input.completed) };
      },
    });
    register({
      name: "save_daily_journal",
      title: "Save daily journal",
      description: "Replace the journal text for the selected day.",
      inputSchema: { type: "object", properties: { text: { type: "string", maxLength: 10000 } }, required: ["text"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input) => ({ date: selectedDate, ...(await saveJournal(String(input.text))) }),
    });
    return () => lifecycle.abort();
  }, [createTask, dashboard, saveJournal, selectedDate, toggleHabit]);
}

export default App;
