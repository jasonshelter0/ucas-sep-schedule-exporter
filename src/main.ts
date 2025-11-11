import browser from "webextension-polyfill"
import { collectLectures, LectureRow, enrichLectureDescriptions } from "./parser"
import { CollectLecturesMetadata, ContentRequest, ContentResponse } from "./message"

browser.runtime.onMessage.addListener((message: ContentRequest) => {
    if (message.type === "collectLectures") {
        return handleCollectRequest()
    }
})

async function handleCollectRequest(): Promise<ContentResponse> {
    try {
        const { lectures, metadata } = await collectAllPages()
        if (!lectures.length) {
            throw new Error("未在当前页面找到讲座表格。")
        }
        return { type: "lectures", lectures, metadata }
    } catch (error) {
        const reason = error instanceof Error ? error.message : `${error}`
        return { type: "error", reason }
    }
}

function collectMetadata(): CollectLecturesMetadata {
    const { totalPages, currentPage, totalItems } = extractPaginationInfo()
    const form = extractFormState()

    return {
        totalPages,
        currentPage,
        totalItems,
        origin: window.location.origin,
        form,
    }
}

function extractPaginationInfo() {
    const infoText = document.querySelector(".b-nextpage .bn-info")?.textContent ?? ""
    const totalMatch = infoText.match(/共\s*(\d+)\s*项/)
    const pageMatch = infoText.match(/当前页\s*(\d+)\s*\/\s*(\d+)/)
    const totalItems = totalMatch ? parseInt(totalMatch[1], 10) : undefined
    const currentPage = pageMatch ? parseInt(pageMatch[1], 10) : 1
    const totalPages = pageMatch ? parseInt(pageMatch[2], 10) || 1 : 1
    return { totalPages, currentPage, totalItems }
}

function extractFormState(): CollectLecturesMetadata["form"] {
    const searchForm = document.forms.namedItem("frm")
    const paginationForm = document.forms.namedItem("pagefrm")
    const action =
        paginationForm?.getAttribute("action") ||
        searchForm?.getAttribute("action") ||
        window.location.pathname
    const method = ((paginationForm?.method || searchForm?.method || "POST").toUpperCase() === "GET")
        ? "GET"
        : "POST"

    const fields: Record<string, string> = {
        ...serializeForm(searchForm),
        ...serializeForm(paginationForm),
    }

    const pageField = detectPageFieldName() || determinePageField(fields)
    if (pageField && !(pageField in fields)) {
        fields[pageField] = ""
    }

    return { action, method, fields, pageField }
}

function serializeForm(form?: HTMLFormElement | null) {
    const result: Record<string, string> = {}
    if (!form) return result

    const elements = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input[name], select[name], textarea[name]"
    )

    elements.forEach(element => {
        if (element instanceof HTMLInputElement) {
            if ((element.type === "checkbox" || element.type === "radio") && !element.checked) return
        }
        result[element.name] = element.value ?? ""
    })

    return result
}

function determinePageField(fields: Record<string, string>) {
    const preferred = Object.keys(fields).find(key =>
        /^page(no|num)$/i.test(key)
    )
    if (preferred) return preferred
    return Object.keys(fields).find(key => /page/i.test(key))
}

function detectPageFieldName() {
    const gotoPage = (window as unknown as Record<string, any>).gotoPage
    if (typeof gotoPage !== "function") return undefined
    const source = gotoPage.toString()
    const match = source.match(/pagefrm\.([a-zA-Z0-9_]+)\.value/)
    if (match) return match[1]
    const match2 = source.match(/document\.getElementById\(['"]([^'"]+)['"]\)\.value/)
    if (match2) return match2[1]
    return undefined
}

async function collectAllPages() {
    const initialMetadata = collectMetadata()
    const totalPages = Math.max(initialMetadata.totalPages || 1, 1)
    const originalPage = Math.max(initialMetadata.currentPage || 1, 1)
    const gotoFn = (window as unknown as Record<string, any>).gotoPage

    const parser = new DOMParser()
    const combined: LectureRow[] = []

    const firstPageLectures = collectLectures()
    combined.push(...firstPageLectures)

    if (initialMetadata.totalPages > 1) {
        for (let page = 1; page <= initialMetadata.totalPages; page++) {
            if (page === initialMetadata.currentPage) continue
            const html = await fetchPageHtml(initialMetadata, page)
            const doc = parser.parseFromString(html, "text/html")
            const pageLectures = collectLectures(doc)
            combined.push(...pageLectures)
        }
    }

    const enriched = await enrichLectureDescriptions(combined)
    return { lectures: enriched, metadata: initialMetadata }
}

async function fetchPageHtml(metadata: CollectLecturesMetadata, page: number) {
    const { form, origin } = metadata
    const actionUrl = new URL(form.action || window.location.pathname, origin || window.location.origin).toString()
    const method = form.method || "POST"

    const params = new URLSearchParams()
    Object.entries(form.fields).forEach(([key, value]) => params.append(key, value))

    const pageField = form.pageField || guessPageFieldName(form.fields) || "pageNo"
    params.set(pageField, page.toString())

    const requestInit: RequestInit = {
        method,
        credentials: "include",
    }

    let url = actionUrl
    if (method === "GET") {
        const requestUrl = new URL(actionUrl)
        params.forEach((value, key) => requestUrl.searchParams.set(key, value))
        url = requestUrl.toString()
    } else {
        requestInit.headers = { "Content-Type": "application/x-www-form-urlencoded" }
        requestInit.body = params.toString()
    }

    const response = await fetch(url, requestInit)
    if (!response.ok) {
        throw new Error(`加载第 ${page} 页失败 (${response.status})`)
    }
    return response.text()
}

function guessPageFieldName(fields: Record<string, string>) {
    const keys = Object.keys(fields)
    const exact = keys.find(key => /^page(no|num)$/i.test(key))
    if (exact) return exact
    return keys.find(key => key.toLowerCase().includes("page"))
}
