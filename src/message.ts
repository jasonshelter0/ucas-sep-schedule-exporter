import type { LectureRow } from "./parser"

export type ContentRequest =
    | { type: "collectLectures" }

export interface CollectLecturesMetadata {
    totalPages: number
    currentPage: number
    totalItems?: number
    origin: string
    form: {
        action: string
        method: "GET" | "POST"
        fields: Record<string, string>
        pageField?: string
    }
}

export type ContentResponse =
    | { type: "lectures"; lectures: LectureRow[]; metadata: CollectLecturesMetadata }
    | { type: "error"; reason: string }
