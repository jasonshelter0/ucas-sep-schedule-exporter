import browser from "webextension-polyfill"

browser.runtime.onInstalled.addListener(() => {
    browser.action.setBadgeBackgroundColor({ color: "#0d6efd" })
    browser.action.setBadgeText({ text: "" })
})
