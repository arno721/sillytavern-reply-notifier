# 🔔 SillyTavern Reply Notifier｜酒館回覆完成通知

[![Tests](https://github.com/arno721/sillytavern-reply-notifier/actions/workflows/test.yml/badge.svg)](https://github.com/arno721/sillytavern-reply-notifier/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

AI 回覆完成後，直接在 **Android、iPhone／iPad、Windows、macOS 與 Linux** 發送原生系統通知，**不需要 ntfy 或其他通知 App**。無須修改酒館原始碼、安裝伺服器插件或建置前端。iOS 請依下方步驟從主畫面開啟酒館。

## 安裝

1. 在 SillyTavern 開啟 **擴充套件 → 安裝擴充套件**。
2. 貼上此倉庫網址：

   ```text
   https://github.com/arno721/sillytavern-reply-notifier.git
   ```

3. 安裝後重新整理，在擴充套件設定找到 **🔔 回覆完成通知**。
4. 點擊 **啟用原生通知**、允許權限，再點擊 **測試原生通知**。

使用 SillyTavern 1.13.0 以上版本；建議更新至目前穩定版。事件介面已對照官方 release 1.19.0 原始碼。插件安裝不需要執行 `npm install`；本倉庫的 Node.js 工具僅供開發及測試。

## 平台與條件

| 接收裝置 | 通知方式 | 設定條件 |
| --- | --- | --- |
| Windows | Chrome／Edge／Firefox 原生系統通知 | HTTPS 或 localhost；允許網站及系統通知 |
| macOS | 支援通知的 Safari／Chrome／Firefox 原生系統通知 | HTTPS 或 localhost；允許瀏覽器及系統通知 |
| Linux | 支援通知的 Chrome／Firefox 原生系統通知 | HTTPS 或 localhost；桌面環境需支援通知 |
| Android | Service Worker 原生系統通知 | HTTPS 或 localhost；支援的瀏覽器；允許網站與 Android 的通知權限 |
| iOS／iPadOS | 主畫面網頁 App 的原生系統通知 | iOS／iPadOS 16.4+、HTTPS、加入主畫面並從圖示開啟；允許通知 |

## Android：原生通知

1. 用支援通知的瀏覽器（例如 Chrome）開啟 **HTTPS 酒館網址**。
2. 在插件設定點擊 **啟用原生通知**，允許網站通知及 Android 的瀏覽器通知權限。
3. 點擊 **測試原生通知**，檢查通知欄。

手機使用 `ServiceWorkerRegistration.showNotification()`；不會嘗試手機瀏覽器不支援的 `new Notification()`。啟用時會先完成授權與通知服務啟動，並顯示失敗原因。

## iPhone／iPad：原生通知

1. 使用 **iOS／iPadOS 16.4 以上版本**，在 Safari 開啟 **HTTPS 酒館網址**。
2. 選擇 **分享 → 加入主畫面**。
3. **從主畫面上的酒館圖示開啟**，進入插件設定。
4. 點擊 **啟用原生通知**、允許通知，再點擊 **測試原生通知**。

普通 Safari 分頁不能啟用此功能。插件會辨識 iPhone 及使用桌面版網站模式的 iPad，提示從主畫面開啟；授權請求直接由按鈕操作觸發，以符合 Safari 的使用者互動要求。通知使用系統通知中心，不需要安裝其他接收 App。[Apple 官方說明](https://webkit.org/blog/13878/)

## 手機背景執行的限制

**執行限制：插件在產生回覆的酒館頁面中偵測完成。** 若這個頁面被關閉，或手機系統在鎖定／切換 App 後暫停它，插件便不能在暫停期間偵測完成或送出通知。Service Worker 不會替酒館在背景持續生成。

這個版本沒有伺服器端的生成監控或 Web Push 發送器，**不保證關閉頁面或長時間鎖屏後仍能偵測到完成**。原生系統通知與背景持續生成是兩個條件；啟用通知權限不會使手機頁面永久執行。

這是依平台 API 設計的相容方案，**並非五種作業系統的實機測試認證**。已驗證的自動化範圍見下方。

## 進階選用：ntfy 跨裝置推送

原生通知不使用 ntfy。只有需要傳到另一台裝置時，才展開設定中的 **進階：ntfy 跨裝置推送（選用）**。

<details>
<summary>ntfy 設定步驟</summary>

1. 依照 [ntfy 官方手機安裝說明](https://docs.ntfy.sh/subscribe/phone/) 安裝 App 並允許通知。
2. 在插件中開啟 **推送到 ntfy**，設定伺服器，例如 `https://ntfy.sh`，或自己的 ntfy 伺服器。
3. 點擊 **產生隨機 Topic**。
4. 在手機 App 訂閱**相同伺服器與 Topic**。
5. 點擊 **測試 ntfy 推送**，確認手機收到範例通知。

需要驗證的伺服器可填入存取權杖。手機端的私人主題也需使用有訂閱權限的帳號。

**自架伺服器與 iOS：** 即時通知需要依照 [ntfy 的 iOS 即時通知設定](https://docs.ntfy.sh/config/#ios-instant-notifications) 設定 APNs 連接的上游；通常是 `upstream-base-url: https://ntfy.sh`。沒有這項設定時，不保證 iOS 能即時收到。手機也必須能連到你設定的伺服器。

自架端點需允許酒館來源的 CORS 請求，包括 JSON 發布及選用的 `Authorization` 標頭。HTTPS 酒館連到 HTTP ntfy 可能被瀏覽器的混合內容政策阻擋，建議使用 HTTPS ntfy。伺服器可帶有反向代理路徑，例如 `https://example.com/ntfy/`；不要在伺服器欄位加上 Topic、帳密或查詢參數。

產生回覆的酒館頁面仍須在電腦或另一台裝置持續執行；接收 ntfy 的手機分頁可以關閉。

</details>

## 功能與設定

- 在成功回覆完成後通知；支援串流、非串流、重新生成與繼續生成。
- 群聊一次生成結束後合併為一則通知。
- 排除停止生成、失敗串流、靜默生成、代替使用者發言、初始問候及系統訊息。
- 可選擇只在酒館分頁位於背景或失去焦點時通知。
- 通知預設只顯示「AI 回覆已完成」，可手動開啟角色名稱與回覆預覽。
- 點擊原生通知可回到酒館；不接管酒館的根 Service Worker，也不攔截網路請求。
- Android／iOS 共用原生通知流程，啟用時先確認通知服務已啟動，手機服務失敗會提示修復步驟。
- 原生與 ntfy 可同時啟用；其中一個失敗不會阻止另一個，也不會中斷酒館生成。
- 設定面板顯示授權狀態及最近的發送結果，提供各通道獨立測試按鈕。

測試按鈕會發送範例通知，並略過總開關與「只在背景通知」條件。

<details>
<summary>查看設定介面（測試樣板）</summary>

![回覆完成通知設定介面](docs/images/settings.png)

</details>

## 隱私

- **ntfy 預設關閉**；未啟用時不會向第三方發送通知資料。
- **預覽預設關閉**。開啟後，角色名稱和回覆摘要會進入系統通知；啟用 ntfy 時也會傳到指定伺服器。推理欄位不會讀取。
- 公開 ntfy 主題通常可被知道 Topic 的人訂閱；隨機 Topic 是存取秘密，不等於權限控管。需要存取控制時請使用已設權限的私人主題。
- 一般偏好、伺服器及 Topic 存在酒館使用者設定中。選填的權杖僅存於目前分頁的 `sessionStorage`，不寫入酒館設定或 `localStorage`；瀏覽器恢復工作階段時可能恢復分頁資料。
- 發送時不夾帶酒館 Cookies；錯誤訊息不顯示伺服器回應正文、權杖或聊天內容。
- 通知連結移除網址中的帳密、查詢參數與片段。若你的登入方式依賴查詢參數，點擊後可能需要重新登入。

## 疑難排解

| 現象 | 檢查方式 |
| --- | --- |
| 安裝時顯示失敗，請求回傳 HTTP 502 | 檢查酒館後端與反向代理日誌。等前一個安裝請求結束後，用上面的完整 `.git` 倉庫網址重試；避免連續發送同一插件的安裝請求。502 本身不足以判斷插件檔案是否有問題。 |
| HTTP 區域網路網址沒有原生通知 | `http://192.168.x.x` 不是安全來源。請設定 HTTPS；手機的 localhost 是手機本身。 |
| iPhone 的普通瀏覽器分頁沒有通知權限 | 用 Safari 開啟 HTTPS 酒館，分享 → 加入主畫面，再從主畫面圖示啟動。 |
| Android 啟用後仍沒有通知 | 同時檢查網站通知與 Android 系統中瀏覽器 App 的通知權限；更新支援 Service Worker 的瀏覽器。 |
| 授權後仍看不到通知 | 檢查 OS 通知權限、勿擾模式及瀏覽器網站設定；通知可能只出現在通知中心。 |
| 手機鎖定後沒收到 | 確認產生回覆的酒館頁面仍在執行。若只在手機開酒館，系統可能已暫停頁面。 |
| ntfy 顯示 HTTP 401／403 | 檢查權杖是否有該 Topic 的發布權限。 |
| ntfy 顯示 HTTP 429 | 檢查服務端的額度／限流規則。 |
| 自架 ntfy 在 iOS 延遲或不通知 | 檢查 APNs 上游設定、App 的伺服器／Topic、網路及通知權限。 |
| 通知點擊後沒有直接回到原聊天 | 插件以安全的酒館頁面網址返回；已有同路徑視窗時會優先聚焦它。 |

## 開發與驗證

需要 Node.js 20+。

```sh
npm ci
npm test
npm run check
npx playwright install chromium webkit
npm run test:browser
```

GitHub Actions 在 Windows、macOS、Linux 執行單元測試，並在 Linux 執行桌面 Chromium／WebKit、Android 裝置設定的 Chromium、iPhone 裝置設定的 WebKit 整合測試。Chromium 使用完整瀏覽器的新版 headless 模式；舊 headless shell 會硬性封鎖通知。

本地驗證包含完成事件的兩種順序、中斷競態、群聊、隱私預設、真實本機 HTTP 發布與逾時、設定儲存、手機寬度版面、實際 Chromium Service Worker 啟動及通知儲存、無 ntfy 的原生完成通知。單元測試涵蓋 iOS 主畫面環境、iPad 偵測、授權互動順序與手機服務失敗路徑。WebKit 自動化不提供 OS 通知授權，因此實際通知測試只在 Chromium 執行。瀏覽器測試使用模擬酒館上下文；另已在實際 SillyTavern 1.19.0 環境確認 Git 安裝與設定面板載入。**裝置模擬不是實機測試；尚未驗證真實 API 生成的完整端到端或 iOS／Android 實機通知**。

實機確認建議：在每台接收裝置完成授權／訂閱後，按通道的測試按鈕，再產生一次正常回覆並驗證停止生成不會誤報。

## 參考

- [SillyTavern 擴充套件介面](https://docs.sillytavern.app/for-contributors/writing-extensions/)
- [Apple WebKit：iOS 主畫面網頁通知](https://webkit.org/blog/13878/)
- [Chrome：Android 平板的桌面網站模式](https://developer.chrome.com/blog/desktop-mode)
- [ntfy JSON 發布 API](https://docs.ntfy.sh/publish/#publish-as-json)

MIT License © 2026 arno721
