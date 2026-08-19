import { createSignal, onMount, Show } from "solid-js";
import { type DayItem, type DayOfWeek, type Todo } from "../schema";
import { createCalendarStore } from "../state";
import { getTodayWeekday } from "../time";
import ClockBar from "./ClockBar";
import ImportModal from "./ImportModal";
import ItemModal, { type ItemType } from "./ItemModal";
import SettingsModal from "./SettingsModal";
import TemplateModal from "./TemplateModal";
import WeekView from "./WeekView";

export default function CalendarApp() {
  const store = createCalendarStore();

  onMount(() => {
    void store.load();
  });

  // Modal States
  const [itemModalOpen, setItemModalOpen] = createSignal(false);
  const [itemToEdit, setItemToEdit] = createSignal<DayItem | Todo | null>(null);
  const [modalDefaultDay, setModalDefaultDay] = createSignal<DayOfWeek>("monday");
  const [modalDefaultType, setModalDefaultType] = createSignal<ItemType>("busy");
  const [modalDefaultStart, setModalDefaultStart] = createSignal(540);
  const [modalDefaultEnd, setModalDefaultEnd] = createSignal(600);

  const [settingsModalOpen, setSettingsModalOpen] = createSignal(false);
  const [importModalOpen, setImportModalOpen] = createSignal(false);

  const [templateModalOpen, setTemplateModalOpen] = createSignal(false);
  const [templateModalDay, setTemplateModalDay] = createSignal<DayOfWeek>("monday");

  // Pointer and HTML5 placement feedback surface here and auto-dismiss.
  const [dragNotice, setDragNotice] = createSignal<{
    message: string;
    kind: "adjusted" | "refused";
  } | null>(null);
  let dragNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  const notifyPlacement = (
    message: string,
    kind: "adjusted" | "refused" = "refused",
  ) => {
    setDragNotice({ message, kind });
    if (dragNoticeTimer !== null) clearTimeout(dragNoticeTimer);
    dragNoticeTimer = setTimeout(() => setDragNotice(null), 3500);
  };

  const handleOpenTemplate = (day: DayOfWeek) => {
    setTemplateModalDay(day);
    setTemplateModalOpen(true);
  };

  const handleOpenAddItem = (
    day?: DayOfWeek,
    defaultType?: ItemType,
    defaultStart = 540,
    defaultEnd = 600,
  ) => {
    setItemToEdit(null);
    setModalDefaultDay(
      day ?? getTodayWeekday(store.doc.settings.timezone),
    );
    setModalDefaultType(defaultType ?? "busy");
    setModalDefaultStart(defaultStart);
    setModalDefaultEnd(defaultEnd);
    setItemModalOpen(true);
  };

  const handleOpenEditItem = (item: DayItem | Todo) => {
    setItemToEdit(item);
    setItemModalOpen(true);
  };

  const handleExport = async () => {
    try {
      const json = await store.exportJson();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tapos-na-${store.doc.settings.timezone.replace("/", "-")}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Export handled gracefully
    }
  };

  return (
    <div class="min-h-screen flex flex-col">
      {/* Header Bar */}
      <header class="navbar bg-base-100 shadow-sm border-b border-base-300 px-4 sm:px-6">
        <div class="navbar-start gap-3">
          <div class="flex items-center gap-2">
            <span class="text-xl font-bold tracking-tight text-primary">tapos-na</span>
            <span class="badge badge-sm badge-outline font-mono text-[10px] hidden sm:inline-flex">
              {store.doc.settings.timezone}
            </span>
          </div>

          {/* Persistence status indicator */}
          <div class="flex items-center gap-1.5 text-xs">
            <Show when={store.status() === "saving"}>
              <span class="text-base-content/60 animate-pulse">Saving...</span>
            </Show>
            <Show when={store.status() === "saved"}>
              <span class="badge badge-xs badge-success">Saved</span>
            </Show>
          </div>
        </div>

        {/* Right: Actions */}
        <div class="navbar-end gap-2">
          <button
            type="button"
            class="btn btn-primary btn-sm hidden sm:inline-flex"
            onClick={() => handleOpenAddItem()}
          >
            + Add Item
          </button>
          <button
            type="button"
            class="btn btn-outline btn-sm"
            onClick={() => setSettingsModalOpen(true)}
            title="Settings"
          >
            ⚙️ Settings
          </button>
          <div class="dropdown dropdown-end">
            <div
              tabIndex={0}
              role="button"
              class="btn btn-ghost btn-sm btn-circle"
              title="More actions"
            >
              ⋮
            </div>
            <ul
              tabIndex={0}
              class="dropdown-content menu z-1 bg-base-100 rounded-box w-40 p-2 shadow-lg border border-base-200 text-xs"
            >
              <li class="sm:hidden">
                <a onClick={() => handleOpenAddItem()}>+ Add Item</a>
              </li>
              <li>
                <a onClick={handleExport}>📥 Export JSON</a>
              </li>
              <li>
                <a onClick={() => setImportModalOpen(true)}>📤 Import JSON</a>
              </li>
            </ul>
          </div>
        </div>
      </header>

      {/* Live wall-clock timer bar */}
      <ClockBar store={store} />

      {/* Drag & drop refusal toast */}
      <Show when={dragNotice()}>
        <div class="fixed left-1/2 top-4 z-50 w-auto -translate-x-1/2">
          <div class={`alert ${dragNotice()?.kind === "adjusted" ? "alert-warning" : "alert-error"} flex items-center gap-2 px-4 py-2 text-xs shadow-lg`}>
            <span>{dragNotice()?.kind === "adjusted" ? "⚠️" : "⛔"}</span>
            <span>{dragNotice()?.message}</span>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              onClick={() => setDragNotice(null)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      </Show>

      {/* Error banner */}
      <Show when={store.errorMessage()}>
        <div class="mx-auto max-w-7xl px-4 pt-4 w-full">
          <div class="alert alert-error text-xs flex justify-between py-2">
            <span>{store.errorMessage()}</span>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              onClick={store.clearError}
            >
              ✕
            </button>
          </div>
        </div>
      </Show>

      {/* Main Content Area */}
      <main class="flex-1 p-4 sm:p-6 mx-auto w-full max-w-7xl">
        <Show when={store.isLoaded()} fallback={
          <div class="flex items-center justify-center py-24 text-base-content/60">
            <span class="loading loading-spinner loading-md mr-2"></span>
            Loading calendar...
          </div>
        }>
          <WeekView
            store={store}
            onOpenAddItem={(day, type, start, end) => handleOpenAddItem(day, type, start, end)}
            onOpenEditItem={handleOpenEditItem}
            onOpenTemplate={handleOpenTemplate}
            onDropRefused={(reason) => notifyPlacement(reason, "refused")}
            onPlacementNotice={notifyPlacement}
          />
        </Show>
      </main>

      {/* Modals */}
      <ItemModal
        isOpen={itemModalOpen()}
        onClose={() => setItemModalOpen(false)}
        store={store}
        itemToEdit={itemToEdit()}
        defaultDay={modalDefaultDay()}
        defaultType={modalDefaultType()}
        defaultStart={modalDefaultStart()}
        defaultEnd={modalDefaultEnd()}
      />

      <SettingsModal
        isOpen={settingsModalOpen()}
        onClose={() => setSettingsModalOpen(false)}
        store={store}
      />

      <ImportModal
        isOpen={importModalOpen()}
        onClose={() => setImportModalOpen(false)}
        store={store}
      />

      <TemplateModal
        isOpen={templateModalOpen()}
        onClose={() => setTemplateModalOpen(false)}
        store={store}
        defaultDay={templateModalDay()}
      />
    </div>
  );
}
