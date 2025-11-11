import * as schedule from "ics"

const lectureTableSelector =
    "table.table.table-striped.table-bordered.table-advance.table-hover tbody tr"

export interface LectureRow {
    id: number
    topic: string
    title: string
    credits: number
    timeText: string
    start: schedule.DateArray
    end: schedule.DateArray
    startTimestamp: number
    endTimestamp: number
    audience: string
    speaker: string
    department: string
    detailUrl?: string
    detailDescription?: string
    mainVenue?: string
    branchVenue?: string
}

export interface LectureDetails {
    description?: string
    mainVenue?: string
    branchVenue?: string
}

/**
 * Export the UCAS lecture table on the current page as an ICS file.
 * @param root document to query (defaults to the live page)
 * @returns number of events written to the ICS file
 */
export function collectLectures(root: Document = document): LectureRow[] {
    return parseLectureRows(root)
}

export function exportLectureSchedule(root: Document = document, lectures?: LectureRow[]): Promise<number> {
    const lectureRows = lectures ?? collectLectures(root)
    return generateIcsFile(lectureRows)
}

export function generateIcsFile(lectureRows: LectureRow[], filename = "schedule.ics"): Promise<number> {
    if (!lectureRows.length) {
        throw new Error("未找到可导出的讲座行，请确认已打开讲座预告页面。")
    }

    const events = lectureRows
        .map(lectureToEvent)
        .filter((event): event is schedule.EventAttributes => !!event)

    if (!events.length) {
        throw new Error("讲座数据格式无法解析，请检查页面内容。")
    }

    return new Promise((resolve, reject) => {
        schedule.createEvents(events, (error, value) => {
            if (error || !value) {
                reject(error ?? new Error("Failed to generate ICS output."))
                return
            }

            downloadIcsFile(value, filename)
            resolve(events.length)
        })
    })
}

function parseLectureRows(root: Document): LectureRow[] {
    const rows = root.querySelectorAll<HTMLTableRowElement>(lectureTableSelector)

    return Array.from(rows)
        .map((row, index) => parseLectureRow(row, index))
        .filter((row): row is LectureRow => row !== undefined)
}

function parseLectureRow(row: HTMLTableRowElement, id: number): LectureRow | undefined {
    const cells = row.querySelectorAll<HTMLTableCellElement>("td")
    if (cells.length < 8) return undefined

    const [
        topicCell,
        titleCell,
        creditsCell,
        timeCell,
        audienceCell,
        speakerCell,
        departmentCell,
        actionCell,
    ] = Array.from(cells)

    const timeText = textOf(timeCell)
    const timing = parseTimeCell(timeText)
    if (!timing) return undefined

    return {
        id,
        topic: textOf(topicCell),
        title: textOf(titleCell),
        credits: parseInt(textOf(creditsCell) || "0", 10),
        timeText,
        start: timing.start,
        end: timing.end,
        startTimestamp: timing.startTimestamp,
        endTimestamp: timing.endTimestamp,
        audience: textOf(audienceCell),
        speaker: textOf(speakerCell),
        department: textOf(departmentCell),
        detailUrl: actionCell.querySelector<HTMLAnchorElement>("a")?.href,
    }
}

function textOf(cell: HTMLTableCellElement) {
    return cell.textContent?.replace(/\s+/g, " ").trim() ?? ""
}

interface ParsedTime {
    start: schedule.DateArray
    end: schedule.DateArray
    startTimestamp: number
    endTimestamp: number
}

function parseTimeCell(value: string): ParsedTime | undefined {
    const normalized = value.replace(/\s+/g, " ").trim()
    const match = normalized.match(
        /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})-(\d{2}):(\d{2})$/
    )
    if (!match) return undefined

    const [, year, month, day, startHour, startMinute, endHour, endMinute] = match
    const numericYear = parseInt(year, 10)
    const numericMonth = parseInt(month, 10)
    const numericDay = parseInt(day, 10)
    const startHourNum = parseInt(startHour, 10)
    const startMinuteNum = parseInt(startMinute, 10)
    const endHourNum = parseInt(endHour, 10)
    const endMinuteNum = parseInt(endMinute, 10)

    const datePrefix: [number, number, number] = [
        numericYear,
        numericMonth,
        numericDay,
    ]

    const startArray: schedule.DateArray = [
        ...datePrefix,
        startHourNum,
        startMinuteNum,
    ]
    const endArray: schedule.DateArray = [
        ...datePrefix,
        endHourNum,
        endMinuteNum,
    ]

    const startTimestamp = new Date(numericYear, numericMonth - 1, numericDay, startHourNum, startMinuteNum).getTime()
    const endTimestamp = new Date(numericYear, numericMonth - 1, numericDay, endHourNum, endMinuteNum).getTime()

    return {
        start: startArray,
        end: endArray,
        startTimestamp,
        endTimestamp,
    }
}

function lectureToEvent(row: LectureRow): schedule.EventAttributes | undefined {
    const descriptionParts = [
        row.topic,
        row.department,
        row.speaker && `主讲人：${row.speaker}`,
        row.audience && `面向：${row.audience}`,
        row.detailDescription?.trim(),
    ].filter(Boolean)

    const description = flattenDescription(descriptionParts.join(" · "))
    const locationParts = [
        row.mainVenue && `主会场：${row.mainVenue}`,
        row.branchVenue && `分会场：${row.branchVenue}`,
    ].filter((part): part is string => !!part)

    const event: schedule.EventAttributes = {
        title: row.title || row.topic || "讲座",
        start: row.start,
        end: row.end,
    }

    if (description) event.description = description
    if (locationParts.length) {
        event.location = locationParts.join("，")
    } else if (row.department) {
        event.location = row.department
    }
    if (row.detailUrl) event.url = row.detailUrl
    if (row.topic) event.categories = [row.topic]

    return event
}

function flattenDescription(value?: string): string {
    if (!value) return ""
    return value
        .replace(/\\[nN]/g, " ")
        .replace(/[\r\n\u0008]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
}

function downloadIcsFile(contents: string, filename = "schedule.ics") {
    const anchor = document.createElement("a")
    anchor.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(contents)
    anchor.download = filename
    anchor.style.display = "none"
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
}

export async function enrichLectureDescriptions(
    lectures: LectureRow[],
    concurrency = 5
): Promise<LectureRow[]> {
    const cache = new Map<string, LectureDetails | undefined>()
    let index = 0

    async function worker() {
        while (index < lectures.length) {
            const current = index++
            const lecture = lectures[current]
            if (!lecture.detailUrl) continue
            if (cache.has(lecture.detailUrl)) {
                applyLectureDetails(lecture, cache.get(lecture.detailUrl))
                continue
            }
            try {
                const details = await fetchLectureDetails(lecture.detailUrl)
                applyLectureDetails(lecture, details)
                cache.set(lecture.detailUrl, details)
            } catch (error) {
                console.error("Failed to fetch detail page:", lecture.detailUrl, error)
                cache.set(lecture.detailUrl, undefined)
            }
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, lectures.length) }, () => worker())
    await Promise.all(workers)
    return lectures
}

export async function fetchLectureDetails(url: string): Promise<LectureDetails> {
    const response = await fetch(url, { credentials: "include" })
    if (!response.ok) throw new Error(`Detail request failed (${response.status})`)
    const html = await response.text()
    const doc = new DOMParser().parseFromString(html, "text/html")
    return extractLectureDetails(doc)
}

export async function fetchLectureDescription(url: string): Promise<string | undefined> {
    const details = await fetchLectureDetails(url)
    return details.description
}

function extractLectureDetails(doc: Document): LectureDetails {
    const rows = Array.from(doc.querySelectorAll("table tr"))
    const details: LectureDetails = {}

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const rawText = row.textContent ?? ""
        const compactText = rawText.replace(/\s+/g, "").trim()
        const normalizedRowText = normalizeCellText(rawText)
        if (!compactText) continue

        if (compactText.includes("讲座介绍")) {
            const contentRow = rows[i + 1]
            if (contentRow) {
                const description = normalizeCellText(contentRow.textContent ?? "")
                if (description) details.description = description
            }
            continue
        }

        const rowVenues = extractVenuesFromRowText(normalizedRowText)
        if (rowVenues.mainVenue && !details.mainVenue) {
            details.mainVenue = rowVenues.mainVenue
        }
        if (rowVenues.branchVenue && !details.branchVenue) {
            details.branchVenue = rowVenues.branchVenue
        }

        const cells = Array.from(row.querySelectorAll("td"))
        const consumed = new Set<number>()
        cells.forEach((cell, index) => {
            if (consumed.has(index)) return
            const labeled = parseLabeledCell(cell.textContent ?? "")
            if (!labeled) return
            const { label, value } = labeled
            let resolvedValue = value

            if (!resolvedValue) {
                const nextCell = cells[index + 1]
                if (nextCell) {
                    const nextText = normalizeCellText(nextCell.textContent ?? "")
                    if (nextText && !containsColon(nextText)) {
                        resolvedValue = nextText
                        consumed.add(index + 1)
                    }
                }
            }

            if (!resolvedValue) return

            const normalizedLabel = label.replace(/\s+/g, "")
            if (isMainVenueLabel(normalizedLabel)) {
                details.mainVenue = resolvedValue
            } else if (isBranchVenueLabel(normalizedLabel)) {
                details.branchVenue = resolvedValue
            }
        })
    }

    return details
}

function parseLabeledCell(text: string): { label: string; value: string } | undefined {
    const normalized = normalizeCellText(text)
    if (!normalized) return undefined
    const match = normalized.match(/^([^：:]+)[：:](.*)$/)
    if (!match) return undefined
    const label = match[1].trim()
    const value = match[2].trim()
    return { label, value }
}

function normalizeCellText(text: string): string {
    return text.replace(/\s+/g, " ").trim()
}

function extractVenuesFromRowText(text: string): { mainVenue?: string; branchVenue?: string } {
    const normalized = text.trim()
    const venues: { mainVenue?: string; branchVenue?: string } = {}

    const mainMatch = normalized.match(/主会场地点：(.+?)(?=分会场(?:地点)?：|$)/)
    if (mainMatch) {
        const value = mainMatch[1].trim()
        if (value) venues.mainVenue = value
    }

    const branchMatch = normalized.match(/分会场地点：(.+)/)
    if (branchMatch) {
        const value = branchMatch[1].trim()
        if (value) venues.branchVenue = value
    }

    return venues
}

function containsColon(text: string): boolean {
    return /[:：]/.test(text)
}

function isMainVenueLabel(label: string): boolean {
    const normalized = label.replace(/\s+/g, "")
    return /主会场/.test(normalized)
}

function isBranchVenueLabel(label: string): boolean {
    const normalized = label.replace(/\s+/g, "")
    return /分会场/.test(normalized)
}

function applyLectureDetails(target: LectureRow, details?: LectureDetails) {
    if (!details) return
    if (details.description !== undefined) {
        target.detailDescription = details.description
    }
    if (details.mainVenue) {
        target.mainVenue = details.mainVenue
    }
    if (details.branchVenue) {
        target.branchVenue = details.branchVenue
    }
}
