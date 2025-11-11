import browser from "webextension-polyfill"
import type { LectureDetails, LectureRow } from "./parser"
import { generateIcsFile, fetchLectureDetails } from "./parser"
import type { CollectLecturesMetadata, ContentRequest, ContentResponse } from "./message"

type StatusKind = "info" | "success" | "error"

const lectureHostPattern = /^https:\/\/xkcts\.ucas\.ac\.cn(?::\d+)?\//i
const lecturePagePattern = /^https:\/\/xkcts\.ucas\.ac\.cn(?::\d+)?\/subject\/lecture/i
const lectureHostQueryPatterns = [
    "https://xkcts.ucas.ac.cn/subject/lecture*",
    "https://xkcts.ucas.ac.cn/*",
    "https://xkcts.ucas.ac.cn:8443/subject/lecture*",
    "https://xkcts.ucas.ac.cn:8443/*",
]

interface Filters {
    topic: string[]
    title: string[]
    speaker: string[]
    department: string[]
    audience: string[]
    credits: string[]
    venueCampus: string[]
    startDate?: string
    endDate?: string
    startTime?: string
    endTime?: string
}

let allLectures: LectureRow[] = []
let filteredLectures: LectureRow[] = []
let selectedLectureIds = new Set<number>()

const filters: Filters = {
    topic: [],
    title: [],
    speaker: [],
    department: [],
    audience: [],
    credits: [],
    venueCampus: [],
}

const campusOptions = ["雁栖湖", "玉泉路", "中关村", "奥运村"]

type MultiFilterKey =
    | "topic"
    | "title"
    | "speaker"
    | "department"
    | "audience"
    | "credits"
    | "venueCampus"
const multiFilterContainerMap: Record<MultiFilterKey, string> = {
    topic: "filter-topic-list",
    title: "filter-title-list",
    speaker: "filter-speaker-list",
    department: "filter-department-list",
    audience: "filter-audience-list",
    credits: "filter-credits-list",
    venueCampus: "filter-venue-campus-list",
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("refresh-btn")?.addEventListener("click", () => loadLectures())
    document.getElementById("export-btn")?.addEventListener("click", () => exportLectures())
    document.getElementById("select-all-btn")?.addEventListener("click", () => selectAllLectures())
    document.getElementById("clear-selection-btn")?.addEventListener("click", () => clearSelectedLectures())
    registerFilterInputs()
    loadLectures()
})

function registerFilterInputs() {
    const startDateInput = document.getElementById("filter-date-start") as HTMLInputElement | null
    if (startDateInput) {
        if (!startDateInput.value) {
            startDateInput.value = formatDate(new Date())
        }
        filters.startDate = startDateInput.value || undefined
        startDateInput.addEventListener("input", () => {
            filters.startDate = startDateInput.value || undefined
            applyFilters({ updateStatus: true })
        })
    }

    const endDateInput = document.getElementById("filter-date-end") as HTMLInputElement | null
    if (endDateInput) {
        if (!endDateInput.value) {
            endDateInput.value = formatDate(addDays(new Date(), 7))
        }
        filters.endDate = endDateInput.value || undefined
        endDateInput.addEventListener("input", () => {
            filters.endDate = endDateInput.value || undefined
            applyFilters({ updateStatus: true })
        })
    }

    const startTimeInput = document.getElementById("filter-time-start") as HTMLInputElement | null
    startTimeInput?.addEventListener("input", () => {
        filters.startTime = startTimeInput.value || undefined
        applyFilters({ updateStatus: true })
    })

    const endTimeInput = document.getElementById("filter-time-end") as HTMLInputElement | null
    endTimeInput?.addEventListener("input", () => {
        filters.endTime = endTimeInput.value || undefined
        applyFilters({ updateStatus: true })
    })
}

async function loadLectures() {
    setStatus("正在读取当前页面的讲座列表…", "info")
    toggleButtons(true)
    try {
        const { lectures } = await requestLectures()
        const normalized = normalizeLectures(lectures)
        if (!normalized.length) {
            clearTable()
            setStatus("未在当前标签页找到讲座数据，请确认已打开讲座预告页面。", "error")
            return
        }

        allLectures = normalized
        populateFilterOptions(allLectures)
        applyFilters({ resetSelection: true })
        setStatus(`共找到 ${allLectures.length} 个讲座，可使用筛选和复选框导出需要的项目。`, "success")
    } catch (error) {
        clearTable()
        setStatus(error instanceof Error ? error.message : `${error}`, "error")
    } finally {
        toggleButtons(false)
    }
}

async function exportLectures() {
    const selectedLectures = filteredLectures.filter(lecture => selectedLectureIds.has(lecture.id))
    if (!selectedLectures.length) {
        setStatus("请至少选择一个讲座再导出。", "error")
        return
    }
    toggleButtons(true)
    setStatus("正在生成 ICS 文件…", "info")
    try {
        const count = await generateIcsFile(selectedLectures)
        setStatus(`已导出 ${count} 个讲座，文件应已自动下载。`, "success")
    } catch (error) {
        setStatus(error instanceof Error ? error.message : `${error}`, "error")
    } finally {
        toggleButtons(false)
    }
}

interface CollectLecturesResult {
    lectures: LectureRow[]
    metadata: CollectLecturesMetadata
}

async function requestLectures(): Promise<CollectLecturesResult> {
    const response = await sendMessageToLectureTab({ type: "collectLectures" })
    if (!response) throw new Error("无法与当前页面通信，请确认已在讲座页面。")
    if (response.type === "error") throw new Error(response.reason)
    if (response.type !== "lectures") throw new Error("收到未知响应。")
    return {
        lectures: response.lectures,
        metadata: ensureMetadata(response.metadata),
    }
}


function applyFilters(options: { resetSelection?: boolean; updateStatus?: boolean } = {}) {
    const { resetSelection = false, updateStatus = false } = options

    if (!allLectures.length) {
        filteredLectures = []
        selectedLectureIds.clear()
        renderLectures([])
        updateSelectionSummary()
        if (updateStatus) setStatus("尚未加载讲座数据。", "info")
        return
    }

    filteredLectures = allLectures.filter(lecture => matchesFilters(lecture))
    if (resetSelection) {
        selectedLectureIds = new Set(filteredLectures.map(lecture => lecture.id))
    } else {
        selectedLectureIds = new Set(filteredLectures.filter(lecture => selectedLectureIds.has(lecture.id)).map(lecture => lecture.id))
    }

    renderLectures(filteredLectures)
    updateSelectionSummary()

    if (updateStatus) {
        const message = filteredLectures.length
            ? `筛选后剩余 ${filteredLectures.length} 个讲座。`
            : "当前筛选条件下没有符合条件的讲座。"
        setStatus(message, filteredLectures.length ? "info" : "error")
    }
}

function populateFilterOptions(lectures: LectureRow[]) {
    const optionMap: Record<MultiFilterKey, string[]> = {
        topic: uniqueValues(lectures.map(lecture => lecture.topic)),
        title: uniqueValues(lectures.map(lecture => lecture.title)),
        speaker: uniqueValues(lectures.map(lecture => lecture.speaker)),
        department: uniqueValues(lectures.map(lecture => lecture.department)),
        audience: uniqueValues(lectures.map(lecture => lecture.audience)),
        credits: uniqueValues(lectures.map(lecture => lecture.credits)),
        venueCampus: campusOptions.slice(),
    };

    (Object.keys(optionMap) as MultiFilterKey[]).forEach(key => {
        filters[key] = filters[key].filter(value => optionMap[key].includes(value))
        renderMultiSelectOptions(key, optionMap[key])
    })
}

function matchesFilters(lecture: LectureRow) {
    if (!multiSelectMatches(lecture.topic, filters.topic)) return false
    if (!multiSelectMatches(lecture.title, filters.title)) return false
    if (!multiSelectMatches(lecture.speaker, filters.speaker)) return false
    if (!multiSelectMatches(lecture.department, filters.department)) return false
    if (!multiSelectMatches(lecture.audience, filters.audience)) return false
    if (!multiSelectMatches(String(lecture.credits), filters.credits)) return false
    if (!venueCampusMatches(lecture, filters.venueCampus)) return false

    const startTimestamp = ensureTimestamp(lecture.startTimestamp, lecture.start)
    if (filters.startDate) {
        const boundary = startOfDay(filters.startDate)
        if (boundary !== undefined && startTimestamp < boundary) return false
    }
    if (filters.endDate) {
        const boundary = endOfDay(filters.endDate)
        if (boundary !== undefined && startTimestamp > boundary) return false
    }

    const lectureStartMinutes = getLectureStartMinutes(lecture)
    const filterStartMinutes = timeStringToMinutes(filters.startTime)
    const filterEndMinutes = timeStringToMinutes(filters.endTime)
    if (filterStartMinutes !== undefined && lectureStartMinutes < filterStartMinutes) return false
    if (filterEndMinutes !== undefined && lectureStartMinutes > filterEndMinutes) return false

    return true
}

function renderLectures(lectures: LectureRow[]) {
    const table = document.getElementById("lecture-table") as HTMLTableElement
    const tbody = document.getElementById("lecture-rows") as HTMLTableSectionElement
    tbody.innerHTML = ""

    if (!lectures.length) {
        if (!allLectures.length) {
            table.classList.add("hidden")
            return
        }
        const emptyRow = document.createElement("tr")
        const emptyCell = document.createElement("td")
        emptyCell.colSpan = 11
        emptyCell.className = "empty-row"
        emptyCell.textContent = "当前筛选条件下没有讲座。"
        emptyRow.appendChild(emptyCell)
        tbody.appendChild(emptyRow)
        table.classList.remove("hidden")
        return
    }

    lectures.forEach(lecture => {
        const row = document.createElement("tr")
        row.appendChild(createSelectCell(lecture))
        row.appendChild(createCell(lecture.topic))
        row.appendChild(createCell(lecture.title))
        row.appendChild(createCell(String(lecture.credits)))
        row.appendChild(createCell(lecture.timeText))
        const mainVenueCell = createCell(lecture.mainVenue)
        const branchVenueCell = createCell(lecture.branchVenue)
        row.appendChild(mainVenueCell)
        row.appendChild(branchVenueCell)
        row.appendChild(createCell(lecture.speaker))
        row.appendChild(createCell(lecture.department))
        row.appendChild(createCell(lecture.audience))
        row.appendChild(createContentCell(lecture, { mainVenueCell, branchVenueCell }))
        tbody.appendChild(row)
    })

    table.classList.remove("hidden")
    syncSelectionCheckboxes()
}

function clearTable() {
    const table = document.getElementById("lecture-table") as HTMLTableElement
    const tbody = document.getElementById("lecture-rows") as HTMLTableSectionElement
    tbody.innerHTML = ""
    table.classList.add("hidden")
    allLectures = []
    filteredLectures = []
    selectedLectureIds.clear()
    populateFilterOptions([])
    updateSelectionSummary()
}

function createSelectCell(lecture: LectureRow) {
    const cell = document.createElement("td")
    const checkbox = document.createElement("input")
    checkbox.type = "checkbox"
    checkbox.dataset.lectureId = lectureIdToString(lecture.id)
    checkbox.checked = selectedLectureIds.has(lecture.id)
    checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
            selectedLectureIds.add(lecture.id)
        } else {
            selectedLectureIds.delete(lecture.id)
        }
        updateSelectionSummary()
    })
    cell.appendChild(checkbox)
    return cell
}

function createCell(text: string | number | undefined) {
    const cell = document.createElement("td")
    cell.textContent = (text ?? "—").toString()
    return cell
}

const lectureDetailsCache = new Map<string, Promise<LectureDetails | undefined>>()

function createContentCell(
    lecture: LectureRow,
    relatedCells?: { mainVenueCell?: HTMLTableCellElement; branchVenueCell?: HTMLTableCellElement }
) {
    const cell = document.createElement("td")
    if (lecture.detailDescription !== undefined) {
        cell.textContent = lecture.detailDescription.trim() || "—"
        updateVenueCells(lecture, relatedCells)
        return cell
    }
    if (!lecture.detailUrl) {
        cell.textContent = "—"
        updateVenueCells(lecture, relatedCells)
        return cell
    }
    cell.textContent = "内容加载中…"
    updateVenueCells(lecture, relatedCells)
    loadLectureDetails(lecture, cell, relatedCells)
    return cell
}

function loadLectureDetails(
    lecture: LectureRow,
    descriptionCell: HTMLTableCellElement,
    relatedCells?: { mainVenueCell?: HTMLTableCellElement; branchVenueCell?: HTMLTableCellElement }
) {
    if (!lecture.detailUrl) return
    if (!lectureDetailsCache.has(lecture.detailUrl)) {
        lectureDetailsCache.set(
            lecture.detailUrl,
            fetchLectureDetails(lecture.detailUrl).catch(error => {
                console.error("Failed to load lecture content:", error)
                return undefined
            })
        )
    }

    lectureDetailsCache.get(lecture.detailUrl)!.then(details => {
        if (details) {
            if (details.description !== undefined) {
                lecture.detailDescription = details.description
            }
            lecture.mainVenue = details.mainVenue
            lecture.branchVenue = details.branchVenue
        } else if (lecture.detailDescription === undefined) {
            lecture.detailDescription = ""
        }

        descriptionCell.textContent = lecture.detailDescription?.trim() || "—"
        updateVenueCells(lecture, relatedCells)
    })
}

function updateVenueCells(
    lecture: LectureRow,
    cells?: { mainVenueCell?: HTMLTableCellElement; branchVenueCell?: HTMLTableCellElement }
) {
    if (cells?.mainVenueCell) {
        cells.mainVenueCell.textContent = lecture.mainVenue?.trim() || "—"
    }
    if (cells?.branchVenueCell) {
        cells.branchVenueCell.textContent = lecture.branchVenue?.trim() || "—"
    }
}

function selectAllLectures() {
    if (!filteredLectures.length) return
    filteredLectures.forEach(lecture => selectedLectureIds.add(lecture.id))
    syncSelectionCheckboxes()
    updateSelectionSummary()
}

function clearSelectedLectures() {
    if (!selectedLectureIds.size) return
    selectedLectureIds.clear()
    syncSelectionCheckboxes()
    updateSelectionSummary()
}

function syncSelectionCheckboxes() {
    const checkboxes = document.querySelectorAll<HTMLInputElement>("input[data-lecture-id]")
    checkboxes.forEach(checkbox => {
        const datasetId = checkbox.dataset.lectureId
        if (!datasetId) return
        const id = Number(datasetId)
        checkbox.checked = selectedLectureIds.has(id)
    })
}

function updateSelectionSummary() {
    const panel = document.getElementById("selection-panel")
    const summary = document.getElementById("selection-summary")
    const selectAllBtn = document.getElementById("select-all-btn") as HTMLButtonElement | null
    const clearBtn = document.getElementById("clear-selection-btn") as HTMLButtonElement | null

    if (!panel || !summary) return

    if (!allLectures.length) {
        panel.classList.add("hidden")
        summary.textContent = "已选择 0 / 0 个讲座"
        if (selectAllBtn) selectAllBtn.disabled = true
        if (clearBtn) clearBtn.disabled = true
        return
    }

    panel.classList.remove("hidden")
    summary.textContent = `已选择 ${selectedLectureIds.size} / ${filteredLectures.length} 个讲座（当前筛选）`
    if (selectAllBtn) selectAllBtn.disabled = filteredLectures.length === 0
    if (clearBtn) clearBtn.disabled = selectedLectureIds.size === 0
}

function renderMultiSelectOptions(filterKey: MultiFilterKey, options: string[]) {
    const containerId = multiFilterContainerMap[filterKey]
    const container = document.getElementById(containerId) as HTMLElement | null
    if (!container) return

    container.innerHTML = ""
    container.classList.add("multi-select")
    container.dataset.filterKey = filterKey
    container.onchange = event => handleMultiSelectChange(container, event)

    if (!options.length) {
        const empty = document.createElement("div")
        empty.className = "multi-select-empty"
        empty.textContent = "暂无数据"
        container.appendChild(empty)
        return
    }

    container.appendChild(createMultiSelectOption("全部", "", filters[filterKey].length === 0))
    options.forEach(value => {
        container.appendChild(
            createMultiSelectOption(value, value, filters[filterKey].includes(value))
        )
    })
}

function handleMultiSelectChange(container: HTMLElement, event: Event) {
    const checkbox = event.target as HTMLInputElement | null
    if (!checkbox || checkbox.type !== "checkbox") return
    const key = container.dataset.filterKey as MultiFilterKey | undefined
    if (!key) return

    if (checkbox.value === "") {
        if (!checkbox.checked) {
            checkbox.checked = true
            return
        }
        filters[key] = []
        container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => {
            if (input !== checkbox) input.checked = false
        })
    } else {
        const checkedValues = Array.from(
            container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
        )
            .filter(input => input.value && input.checked)
            .map(input => input.value)

        filters[key] = checkedValues
        const allCheckbox = container.querySelector<HTMLInputElement>('input[value=""]')
        if (allCheckbox) {
            allCheckbox.checked = checkedValues.length === 0
        }

        if (!checkedValues.length && allCheckbox) {
            filters[key] = []
            allCheckbox.checked = true
        }
    }

    applyFilters({ updateStatus: true })
}

function createMultiSelectOption(labelText: string, value: string, checked: boolean) {
    const label = document.createElement("label")
    label.className = "multi-select-option"
    const checkbox = document.createElement("input")
    checkbox.type = "checkbox"
    checkbox.value = value
    checkbox.checked = checked
    const span = document.createElement("span")
    span.textContent = labelText
    label.appendChild(checkbox)
    label.appendChild(span)
    return label
}

async function getLectureTabId(): Promise<number> {
    const tab = await findLectureTab()
    if (!tab || !tab.id) {
        throw new Error("请先在任意标签页打开 https://xkcts.ucas.ac.cn/subject/lecture。")
    }
    return tab.id
}

async function findLectureTab(): Promise<browser.Tabs.Tab | undefined> {
    const [currentActive] = await browser.tabs.query({ active: true, currentWindow: true })
    if (matchesLectureUrl(currentActive?.url)) {
        return currentActive
    }

    const matches = await browser.tabs.query({ url: lectureHostQueryPatterns })
    const prioritized = pickBestLectureTab(matches)
    if (prioritized) return prioritized

    const allTabs = await browser.tabs.query({})
    const fallbackMatches = allTabs.filter(tab => matchesLectureUrl(tab.url))
    return pickBestLectureTab(fallbackMatches)
}

async function sendMessageToLectureTab(message: ContentRequest): Promise<ContentResponse | undefined> {
    try {
        const tabId = await getLectureTabId()
        return await browser.tabs.sendMessage(tabId, message)
    } catch (error) {
        console.error("Failed to contact content script:", error)
        return undefined
    }
}

function pickBestLectureTab(tabs: browser.Tabs.Tab[]): browser.Tabs.Tab | undefined {
    if (!tabs.length) return undefined
    const activeMatch = tabs.find(tab => tab.active)
    if (activeMatch) return activeMatch
    if (tabs.length === 1) return tabs[0]
    const sorted = [...tabs].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
    return sorted[0] ?? tabs[0]
}

function matchesLectureUrl(url?: string | null) {
    if (!url) return false
    if (lecturePagePattern.test(url)) return true
    return lectureHostPattern.test(url)
}

function setStatus(message: string, kind: StatusKind) {
    const status = document.getElementById("status")
    if (!status) return
    status.textContent = message
    status.className = `status status-${kind}`
}

function toggleButtons(disabled: boolean) {
    const buttons = document.querySelectorAll<HTMLButtonElement>("button[data-action]")
    buttons.forEach(button => {
        button.disabled = disabled
    })
}

function normalizeLectures(lectures: LectureRow[], startIndex = 0): LectureRow[] {
    return lectures.map((lecture, index) => {
        const normalizedId = startIndex + index
        return {
            ...lecture,
            id: normalizedId,
            startTimestamp: ensureTimestamp(lecture.startTimestamp, lecture.start),
            endTimestamp: ensureTimestamp(lecture.endTimestamp, lecture.end),
        }
    })
}

function ensureTimestamp(timestamp: number | undefined, array: number[] | undefined) {
    if (typeof timestamp === "number" && !Number.isNaN(timestamp)) return timestamp
    return dateArrayToTimestamp(array)
}

function dateArrayToTimestamp(array: number[] | undefined) {
    if (!array || array.length < 3) return Date.now()
    const [year, month, day, hour = 0, minute = 0] = array
    return new Date(year, month - 1, day, hour, minute).getTime()
}

function uniqueValues(values: Array<string | number | undefined | null>) {
    const set = new Set<string>()
    values.forEach(value => {
        if (value === undefined || value === null) return
        const normalized = `${value}`.trim()
        if (normalized) set.add(normalized)
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"))
}

function startOfDay(dateString: string | undefined) {
    if (!dateString) return undefined
    const [year, month, day] = dateString.split("-").map(part => Number(part))
    if ([year, month, day].some(part => Number.isNaN(part))) return undefined
    return new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
}

function endOfDay(dateString: string | undefined) {
    if (!dateString) return undefined
    const [year, month, day] = dateString.split("-").map(part => Number(part))
    if ([year, month, day].some(part => Number.isNaN(part))) return undefined
    return new Date(year, month - 1, day, 23, 59, 59, 999).getTime()
}

function timeStringToMinutes(value: string | undefined) {
    if (!value) return undefined
    const [hour, minute] = value.split(":").map(part => Number(part))
    if (Number.isNaN(hour) || Number.isNaN(minute)) return undefined
    return hour * 60 + minute
}

function getLectureStartMinutes(lecture: LectureRow) {
    const [, , , hour = 0, minute = 0] = lecture.start
    return hour * 60 + minute
}

function lectureIdToString(id: number) {
    return (typeof id === "number" && !Number.isNaN(id)) ? id.toString() : ""
}

function multiSelectMatches(value: string | number | undefined, selectedValues: string[]) {
    if (!selectedValues.length) return true
    return selectedValues.includes(`${value ?? ""}`)
}

function venueCampusMatches(lecture: LectureRow, selectedCampuses: string[]) {
    if (!selectedCampuses.length) return true
    const venues = [lecture.mainVenue, lecture.branchVenue]
        .map(value => value?.trim())
        .filter((value): value is string => !!value)
    if (!venues.length) return false
    return selectedCampuses.some(campus =>
        venues.some(venue => venue.includes(campus))
    )
}

function formatDate(date: Date) {
    const year = date.getFullYear()
    const month = `${date.getMonth() + 1}`.padStart(2, "0")
    const day = `${date.getDate()}`.padStart(2, "0")
    return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number) {
    const copy = new Date(date)
    copy.setDate(copy.getDate() + days)
    return copy
}

function ensureMetadata(metadata?: CollectLecturesMetadata): CollectLecturesMetadata {
    if (metadata) return metadata
    return {
        totalPages: 1,
        currentPage: 1,
        origin: "",
        form: { action: "", method: "POST", fields: {}, pageField: undefined },
    }
}
