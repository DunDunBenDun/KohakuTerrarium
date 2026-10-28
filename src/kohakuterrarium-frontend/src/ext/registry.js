/**
 * Bridges UI contributions into the dashboard's own registries.
 *
 * Each declared contribution gets a host component registered at once
 * (tab kind, layout panel, rail group, settings section, or in-chat
 * renderer), so its launcher exists before any package code loads. The
 * host renders the real component once the entry has called ``kt.register*``.
 */

import { defineComponent, h, markRaw } from "vue"

import ExtensionContribution from "@/ext/ExtensionContribution.vue"
import { registerToolRenderer, registerTriggerRenderer, unregisterRenderers } from "@/ext/renderers"
import {
  contributionComponents,
  contributionKey,
  extState,
  findContribution,
  findPackage,
  parseContributionKey,
} from "@/ext/state"
import { useLayoutStore } from "@/stores/layout"
import {
  registerSettingsSection,
  unregisterSettingsSection,
} from "@/stores/settingsSectionRegistry"
import { railGroups, registerRailGroup, registerTabKind, tabKinds } from "@/stores/tabKindRegistry"
import { useTabsStore } from "@/stores/tabs"

const _registered = []

/** Owner kind each mount kind requires (mirrors ``packages/ui_slot.py``). */
export const MOUNT_OWNER_KINDS = {
  settings: "package",
  tab: "package",
  rail: "package",
  panel: "plugin",
  "tool-renderer": "tool",
  "trigger-renderer": "trigger",
}

function ownerName(owner) {
  return String(owner || "").slice(String(owner || "").indexOf(":") + 1)
}

function hostFor(pkg, contribution) {
  return markRaw(
    defineComponent({
      name: `KtExtensionHost`,
      inheritAttrs: false,
      setup(_props, { attrs }) {
        return () => h(ExtensionContribution, { ...attrs, pkg, contribution })
      },
    }),
  )
}

/** Register one contribution's host into the core registry for its kind. */
export function registerContribution(pkg, contribution) {
  const key = contributionKey(pkg, contribution.id)
  const host = hostFor(pkg, contribution)
  switch (contribution.kind) {
    case "tab":
      registerTabKind({
        kind: key,
        component: host,
        minDensity: contribution.minDensity || "compact",
        capabilities: { extension: true },
      })
      break
    case "panel":
      useLayoutStore().registerPanel({
        id: key,
        label: contribution.label,
        description: contribution.description || "",
        component: host,
      })
      break
    case "rail":
      registerRailGroup({ id: key, component: host, order: contribution.order ?? 100 })
      break
    case "settings":
      registerSettingsSection({
        id: key,
        label: contribution.label,
        order: contribution.order ?? 100,
        component: host,
      })
      break
    case "tool-renderer":
    case "trigger-renderer": {
      const register =
        contribution.kind === "tool-renderer" ? registerToolRenderer : registerTriggerRenderer
      if (!register(ownerName(contribution.owner), { key, pkg, contribution, component: host }))
        return null
      break
    }
    default:
      return null
  }
  _registered.push({ kind: contribution.kind, key })
  return key
}

/** Register every declared contribution of a listed package. */
export function registerPackageContributions(record) {
  for (const contribution of record.contributes || [])
    registerContribution(record.package, contribution)
}

/** Remove every contribution registered through this module. */
export function unregisterAllContributions() {
  const layout = useLayoutStore()
  const removed = _registered.splice(0)
  for (const { kind, key } of removed) {
    if (kind === "tab") tabKinds.delete(key)
    else if (kind === "panel") layout.unregisterPanel(key)
    else if (kind === "rail") railGroups.delete(key)
    else if (kind === "settings") unregisterSettingsSection(key)
  }
  unregisterRenderers(removed.map((r) => r.key))
  contributionComponents.clear()
}

/** Keys of every currently registered contribution, in registration order. */
export function registeredContributionKeys() {
  return _registered.map((r) => r.key)
}

/**
 * Store the component a package provides for ``kind``/``id``. An id the
 * manifest did not declare is registered on the fly as an inline contribution.
 */
export function provideContributionComponent(pkg, kind, id, component, options = {}) {
  if (!component) throw new Error(`${pkg}: register${kind} ${id} needs a component`)
  const declared = findContribution(pkg, id)
  if (declared && declared.kind !== kind) {
    throw new Error(`${pkg}: ${id} is declared as a ${declared.kind}, not a ${kind}`)
  }
  if (!declared) {
    const record = findPackage(pkg)
    const ownerKind = MOUNT_OWNER_KINDS[kind]
    const owner = options.owner || (ownerKind === "package" ? `package:${pkg}` : "")
    if (
      !owner.startsWith(`${ownerKind}:`) ||
      (ownerKind === "package" && owner !== `package:${pkg}`)
    ) {
      throw new Error(
        `${pkg}: an undeclared ${kind} ${id} needs options.owner "${ownerKind}:<name>"`,
      )
    }
    const contribution = {
      kind,
      id,
      owner,
      label: options.label || id,
      icon: options.icon || "",
      description: options.description || "",
      order: options.order ?? 100,
      minDensity: options.minDensity || "compact",
      isolation: "inline",
    }
    if (record) record.contributes = [...(record.contributes || []), contribution]
    registerContribution(pkg, contribution)
  }
  contributionComponents.set(contributionKey(pkg, id), markRaw(component))
}

/** Label and icon of an extension tab kind, or ``null`` for a non-extension kind. */
export function extensionTabMeta(kind) {
  const parts = parseContributionKey(kind)
  if (!parts || !String(kind).startsWith("ext:")) return null
  const c = findContribution(parts.pkg, parts.id)
  return c ? { label: c.label, icon: c.icon || "i-carbon-application" } : null
}

/** Every tab contribution on the active host, for the new-tab menu. */
export function extensionTabLaunchers() {
  const out = []
  for (const record of extState.packages) {
    if (!record.enabled || record.status === "incompatible") continue
    for (const c of record.contributes || []) {
      if (c.kind === "tab")
        out.push({
          key: contributionKey(record.package, c.id),
          label: c.label,
          icon: c.icon || "i-carbon-application",
          package: record.package,
        })
    }
  }
  return out
}

/** Open ``"<package>/<id>"`` (or its ``ext:`` key) as a tab. */
export function openExtensionTab(target) {
  const parts = parseContributionKey(target)
  if (!parts) throw new Error(`not an extension tab: ${target}`)
  const key = contributionKey(parts.pkg, parts.id)
  const c = findContribution(parts.pkg, parts.id)
  return useTabsStore().openTab({ kind: key, id: key, label: c?.label || parts.id })
}
