import { getSettingsValue, initSettings } from "browser-extension-settings"
import {
  $,
  $$,
  addClass,
  addEventListener,
  addStyle,
  createElement,
  createHTML,
  doc,
  getAttribute,
  hasClass,
  removeClass,
  setStyle,
  throttle,
  uniq,
} from "browser-extension-utils"
import styleText from "data-text:./content.scss"

import createTag from "./components/tag"
import { i } from "./messages"
import { outputData } from "./modules/export-import"
import { bindDocumentEvents, hideAllUtagsInArea } from "./modules/global-events"
import { getConditionNodes, getListNodes, matchedNodes } from "./sites/index"
import {
  addTagsValueChangeListener,
  getCachedUrlMap,
  getTags,
  migration,
  saveTags,
} from "./storage/index"
import { type UserTag, type UserTagMeta } from "./types"

const host = location.host

const isEnabledByDefault = () => {
  if (host.includes("www.bilibili.com")) {
    return false
  }

  return true
}

const settingsTable = {
  [`enableCurrentSite_${host}`]: {
    title: i("settings.enableCurrentSite"),
    defaultValue: isEnabledByDefault(),
  },
  showHidedItems: {
    title: i("settings.showHidedItems"),
    defaultValue: false,
    group: 2,
  },
  noOpacityEffect: {
    title: i("settings.noOpacityEffect"),
    defaultValue: false,
    group: 2,
  },
  openTagsPage: {
    title: i("settings.openTagsPage"),
    type: "externalLink",
    url: "https://utags.pipecraft.net/tags/",
    group: 3,
  },
  openDataPage: {
    title: i("settings.openDataPage"),
    type: "externalLink",
    url: "https://utags.pipecraft.net/data/",
    group: 3,
  },
}

const addUtagsStyle = () => {
  const style = addStyle(styleText)
  style.id = "utags_style"
}

function onSettingsChange() {
  if (getSettingsValue("showHidedItems")) {
    addClass(doc.documentElement, "utags_no_hide")
  } else {
    removeClass(doc.documentElement, "utags_no_hide")
  }

  if (getSettingsValue("noOpacityEffect")) {
    addClass(doc.documentElement, "utags_no_opacity_effect")
  } else {
    removeClass(doc.documentElement, "utags_no_opacity_effect")
  }

  if (!getSettingsValue(`enableCurrentSite_${host}`)) {
    for (const element of $$(".utags_ul")) {
      element.remove()
    }

    const style = $("#utags_style")
    if (style) {
      style.remove()
    }
  }
}

// For debug, 0 disable, 1 enable
let start = 0

if (start) {
  start = Date.now()
}

function appendTagsToPage(
  element: HTMLElement,
  key: string,
  tags: string[],
  meta: UserTagMeta | undefined
) {
  const utagsUl = element.nextSibling as HTMLElement
  if (hasClass(utagsUl, "utags_ul")) {
    if (
      element.dataset.utags === tags.join(",") &&
      key === getAttribute(utagsUl, "data-utags_key")
    ) {
      return
    }

    utagsUl.remove()
  }

  const ul = createElement("ul", {
    class: "utags_ul",
    "data-utags_key": key,
  })
  let li = createElement("li")
  if (tags.length === 0) {
    addClass(ul, "notag")
  }

  const a = createElement("button", {
    // href: "",
    // tabindex: "0",
    title: "Add tags",
    "data-utags_tag": "🏷️",
    "data-utags_key": key,
    "data-utags_tags": tags.join(", "),
    "data-utags_meta": meta ? JSON.stringify(meta) : "",
    class:
      tags.length === 0
        ? "utags_text_tag utags_captain_tag"
        : "utags_text_tag utags_captain_tag2",
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="currentColor" class="bi bi-tags-fill" viewBox="0 0 16 16">
<path d="M2 2a1 1 0 0 1 1-1h4.586a1 1 0 0 1 .707.293l7 7a1 1 0 0 1 0 1.414l-4.586 4.586a1 1 0 0 1-1.414 0l-7-7A1 1 0 0 1 2 6.586V2zm3.5 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/>
<path d="M1.293 7.793A1 1 0 0 1 1 7.086V2a1 1 0 0 0-1 1v4.586a1 1 0 0 0 .293.707l7 7a1 1 0 0 0 1.414 0l.043-.043-7.457-7.457z"/>
</svg>
`
  a.innerHTML = createHTML(svg)

  li.append(a)
  ul.append(li)

  for (const tag of tags) {
    li = createElement("li")
    const a = createTag(tag)
    li.append(a)
    ul.append(li)
  }

  element.after(ul)
  element.dataset.utags = tags.join(",")
  /* Fix v2ex polish start */
  // 为了防止阻塞渲染页面，延迟执行
  setTimeout(() => {
    const style = getComputedStyle(element)
    const zIndex = style.zIndex
    if (zIndex && zIndex !== "auto") {
      setStyle(ul, { zIndex })
    }
  }, 200)
  /* Fix v2ex polish end */
}

/**
 * Clean utags elements after SPA web apps re-rendered.
 * works on these sites
 * - youtube
 */
function cleanUnusedUtags() {
  const utagsUlList = $$(".utags_ul")
  for (const utagsUl of utagsUlList) {
    const element = utagsUl.previousSibling as HTMLElement
    if (element && getAttribute(element, "data-utags") !== null) {
      continue
    }

    utagsUl.remove()
  }
}

async function displayTags() {
  if (start) {
    console.error("start of displayTags", Date.now() - start)
  }

  // console.error("displayTags")
  const listNodes = getListNodes()
  for (const node of listNodes) {
    // Flag list nodes first
    node.dataset.utags_list_node = ""
  }

  const conditionNodes = getConditionNodes()
  for (const node of conditionNodes) {
    // Flag condition nodes
    node.dataset.utags_condition_node = ""
  }

  if (start) {
    console.error("before matchedNodes", Date.now() - start)
  }

  // Display tags for matched components on matched pages
  const nodes = matchedNodes()
  if (start) {
    console.error("after matchedNodes", Date.now() - start, nodes.length)
  }

  await getCachedUrlMap()

  for (const node of nodes) {
    const utags: UserTag = node.utags as UserTag
    if (!utags) {
      continue
    }

    const key = utags.key
    if (!key) {
      continue
    }

    const object = getTags(key)

    const tags: string[] = (object.tags as string[]) || []
    appendTagsToPage(node, key, tags, utags.meta)
  }

  if (start) {
    console.error("after appendTagsToPage", Date.now() - start)
  }

  for (const node of listNodes) {
    const conditionNodes = $$("[data-utags_condition_node]", node)
    const tagsArray: string[] = []
    for (const node2 of conditionNodes) {
      if (node2.closest("[data-utags_list_node]") !== node) {
        // Nested list node
        continue
      }

      if (node2.dataset.utags) {
        tagsArray.push(node2.dataset.utags)
      }
    }

    if (tagsArray.length === 1) {
      node.dataset.utags_list_node = "," + tagsArray[0] + ","
    } else if (tagsArray.length > 1) {
      node.dataset.utags_list_node =
        "," + uniq(tagsArray.join(",").split(",")).join(",") + ","
    }
  }

  cleanUnusedUtags()

  if (start) {
    console.error("end of displayTags", Date.now() - start)
  }
}

const displayTagsThrottled = throttle(displayTags, 500)

async function initStorage() {
  await migration()
  addTagsValueChangeListener(() => {
    if (!doc.hidden) {
      setTimeout(displayTags)
    }
  })
}

async function main() {
  if ($("#utags_style")) {
    // already running
    console.log(
      // eslint-disable-next-line n/prefer-global/process
      `[UTags] [${process.env.PLASMO_TARGET}-${process.env.PLASMO_TAG}] Skip this, since another instance is already running.`,
      location.href
    )
    return
  }

  addUtagsStyle()

  await initSettings({
    id: "utags",
    title: i("settings.title"),
    footer: `
    <p>${i("settings.information")}</p>
    <p>
    <a href="https://github.com/utags/utags/issues" target="_blank">
    ${i("settings.report")}
    </a></p>
    <p>Made with ❤️ by
    <a href="https://www.pipecraft.net/" target="_blank">
      Pipecraft
    </a></p>`,
    settingsTable,
    async onValueChange() {
      onSettingsChange()
    },
  })

  if (!getSettingsValue(`enableCurrentSite_${host}`)) {
    return
  }

  await initStorage()

  setTimeout(outputData, 1)

  onSettingsChange()

  await displayTags()

  addEventListener(doc, "visibilitychange", async () => {
    if (!doc.hidden) {
      await displayTags()
    }
  })

  bindDocumentEvents()

  const observer = new MutationObserver(async (mutationsList) => {
    // console.error("mutation", Date.now(), mutationsList)

    displayTagsThrottled()

    if ($("#vimiumHintMarkerContainer")) {
      addClass(doc.body, "utags_show_all")
      addClass(doc.documentElement, "utags_vimium_hint")
    } else if (hasClass(doc.documentElement, "utags_vimium_hint")) {
      removeClass(doc.documentElement, "utags_vimium_hint")
      hideAllUtagsInArea()
    }
  })
  observer.observe(doc, {
    childList: true,
    subtree: true,
  })
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises, unicorn/prefer-top-level-await
main()
