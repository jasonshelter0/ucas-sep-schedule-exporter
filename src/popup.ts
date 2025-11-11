import browser from "webextension-polyfill"

type LauncherStatus = "info" | "success" | "error"

document.addEventListener("DOMContentLoaded", () => {
    const openButton = document.getElementById("open-manager-btn") as HTMLButtonElement | null
    const statusElement = document.getElementById("launcher-status")

    if (!openButton || !statusElement) {
        console.error("Launcher markup missing required elements.")
        return
    }

    openButton.addEventListener("click", () => openManagerTab(openButton, statusElement))
})

async function openManagerTab(button: HTMLButtonElement, statusElement: HTMLElement) {
    button.disabled = true
    setStatus(statusElement, "正在打开讲座管理器…", "info")

    try {
        const managerUrl = browser.runtime.getURL("manager.html")
        const existingTab = await findExistingManagerTab(managerUrl)

        if (existingTab && existingTab.id !== undefined) {
            await browser.tabs.update(existingTab.id, { active: true })
            if (existingTab.windowId !== undefined) {
                await browser.windows.update(existingTab.windowId, { focused: true })
            }
        } else {
            await browser.tabs.create({ url: managerUrl, active: true })
        }

        setStatus(statusElement, "讲座管理器已在新标签页打开。", "success")
        window.close()
    } catch (error) {
        console.error("Failed to open manager tab:", error)
        const message = error instanceof Error ? error.message : `${error}`
        setStatus(statusElement, `无法打开讲座管理器：${message}`, "error")
        button.disabled = false
    }
}

async function findExistingManagerTab(managerUrl: string) {
    const tabs = await browser.tabs.query({ url: managerUrl })
    return tabs[0]
}

function setStatus(element: HTMLElement, message: string, kind: LauncherStatus) {
    element.textContent = message
    element.className = `launcher-status launcher-status-${kind}`
}
