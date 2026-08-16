import { createEffect, createSignal, Show } from "solid-js";
import type { CalendarStore } from "../state";

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  store: CalendarStore;
}

export default function ImportModal(props: ImportModalProps) {
  const [jsonText, setJsonText] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    if (!props.isOpen) return;
    setJsonText("");
    setError(null);
  });

  const handleFileUpload = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setJsonText(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async (e: SubmitEvent) => {
    e.preventDefault();
    const text = jsonText().trim();
    if (!text) {
      setError("Please provide JSON content or upload a file.");
      return;
    }
    const result = await props.store.importJson(text);
    if (result.success) {
      props.onClose();
    } else {
      setError(result.error ?? "Invalid calendar JSON document.");
    }
  };

  return (
    <Show when={props.isOpen}>
      <div class="modal modal-open" role="dialog" aria-modal="true">
        <div class="modal-box max-w-lg">
          <div class="flex items-center justify-between border-b border-base-200 pb-3">
            <h3 class="font-bold text-lg">Import Calendar JSON</h3>
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-circle"
              onClick={props.onClose}
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>

          <p class="text-xs text-base-content/70 mt-2">
            Restore your week from JSON. Corrupt files will be safely rejected
            without modifying current data.
          </p>

          <form onSubmit={handleImport} class="mt-4 space-y-4">
            <Show when={error()}>
              <div class="alert alert-error text-xs py-2">
                <span>{error()}</span>
              </div>
            </Show>

            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">Upload File</span>
              </label>
              <input
                type="file"
                accept=".json,application/json"
                class="file-input file-input-bordered file-input-sm w-full"
                onChange={handleFileUpload}
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">Or Paste JSON</span>
              </label>
              <textarea
                class="textarea textarea-bordered font-mono text-xs h-36 w-full"
                placeholder='{"version": 1, ...}'
                value={jsonText()}
                onInput={(e) => setJsonText(e.currentTarget.value)}
              />
            </div>

            <div class="modal-action border-t border-base-200 pt-3">
              <button
                type="button"
                class="btn btn-ghost"
                onClick={props.onClose}
              >
                Cancel
              </button>
              <button type="submit" class="btn btn-primary">
                Import & Replace
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
}
