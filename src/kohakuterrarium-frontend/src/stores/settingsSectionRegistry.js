/**
 * Settings-section registry: id → { id, label, labelKey, order, component, inline, visible }.
 *
 * Settings renders one tab per visible entry, sorted by ``order``.
 * ``inline`` entries are built-in sections whose markup lives in
 * SettingsPage itself; every other entry renders its ``component``.
 */

import { markRaw, reactive } from "vue"

import { useClusterStore } from "@/stores/cluster"

export const settingsSections = reactive(new Map())

export function registerSettingsSection({
  id,
  label = "",
  labelKey = "",
  order = 100,
  component = null,
  inline = false,
  visible = null,
}) {
  if (!id) return
  if (!inline && !component) throw new Error(`settings section ${id} needs a component`)
  settingsSections.set(id, {
    id,
    label: label || id,
    labelKey,
    order,
    component: component ? markRaw(component) : null,
    inline,
    visible,
  })
}

export function unregisterSettingsSection(id) {
  settingsSections.delete(id)
}

/** Visible sections in display order (ties keep registration order). */
export function visibleSettingsSections() {
  return [...settingsSections.values()]
    .filter((s) => !s.visible || s.visible())
    .sort((a, b) => a.order - b.order)
}

const BUILTIN_SECTIONS = [
  { id: "providers", labelKey: "settings.tabs.providers", order: 10 },
  { id: "models", labelKey: "settings.tabs.models", order: 20 },
  { id: "mcp", labelKey: "settings.tabs.mcp", order: 30 },
  { id: "account", labelKey: "settings.tabs.account", order: 40 },
  {
    id: "sites",
    labelKey: "cluster.settings.title",
    order: 50,
    visible: () => useClusterStore().isCluster,
  },
  { id: "drives", label: "Drives", order: 60 },
  { id: "sessions", labelKey: "settings.tabs.sessions", order: 70 },
  { id: "updates", label: "Updates", order: 80 },
  { id: "advanced", labelKey: "settings.tabs.advanced", order: 90 },
  { id: "about", labelKey: "settings.tabs.about", order: 100 },
  { id: "prefs", labelKey: "settings.tabs.prefs", order: 110 },
]

/** Register the built-in sections. Idempotent. */
export function registerBuiltinSettingsSections() {
  for (const section of BUILTIN_SECTIONS) {
    if (!settingsSections.has(section.id)) registerSettingsSection({ ...section, inline: true })
  }
}
