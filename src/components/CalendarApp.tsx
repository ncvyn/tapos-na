import { createSignal, onMount, Show } from "solid-js";
import { type DayItem, type DayOfWeek, type Todo } from "../schema";
import { createCalendarStore } from "../state";
import DayView from "./DayView";
import ImportModal from "./ImportModal";
import ItemModal, { type ItemType } from "./ItemModal";
import SettingsModal from "./SettingsModal";
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

  const [settingsModalOpen, setSettingsModalOpen] = createSignal(false);
  const [importModalOpen, setImportModalOpen] = createSignal(false);

  const handleOpenAddItem = (day?: DayOfWeek, defaultType?: ItemType) => {
    setItemToEdit(null);
    setModalDefaultDay(day ?? store.selectedDay());
    setModalDefaultType(defaultType ?? "busy");
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

        {/* Center: Week / Day View Toggle */}
        <div class="navbar-center">
          <div class="join">
            <button
              type="button"
              class={`join-item btn btn-sm ${
                store.viewMode() === "week" ? "btn-primary" : "btn-ghost"
              }`}
              onClick={() => store.setViewMode("week")}
            >
              Week View
            </button>
            <button
              type="button"
              class={`join-item btn btn-sm ${
                store.viewMode() === "day" ? "btn-primary" : "btn-ghost"
              }`}
              onClick={() => store.setViewMode("day")}
            >
              Day View
            </button>
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
          <Show when={store.viewMode() === "week"}>
            <WeekView
              store={store}
              onOpenAddItem={(day) => handleOpenAddItem(day)}
              onOpenEditItem={handleOpenEditItem}
            />
          </Show>

          <Show when={store.viewMode() === "day"}>
            <DayView
              store={store}
              onOpenAddItem={(day, type) => handleOpenAddItem(day, type)}
              onOpenEditItem={handleOpenEditItem}
            />
          </Show>
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
    </div>
  );
}
