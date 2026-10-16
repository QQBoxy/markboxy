# Markboxy

以 Skitch 2.9 為基準的本機圖片標註工具，使用 TypeScript／Canvas 2D；macOS、Windows 桌面版使用 Tauri 2，直接載入相同的前端與幾何程式。

目前 P1／P2 核心功能已實作，macOS arm64 App 已啟動並驗證原生檔案往返；Windows 程式與手動建置流程已加入，**尚未在 Windows 實機驗證**。P3～P5 還有原生截圖、平台回歸及 UI 比對待驗收，不能視為全階段完成。完整狀態見 [PLAN.md](PLAN.md)，本機證據見 `analysis/p1-p5/VALIDATION.md`。

## 網頁版啟動

使用 Node.js 24：

```sh
npm ci
npm run dev
```

正式建置預覽：

```sh
npm run build
npm run preview -- --port 4175
```

圖片與文件均在本機處理，沒有帳號、後端服務或圖片上傳。

## 操作

啟動時為空白畫布，不預放示範箭頭；初始顏色為紅色、粗細為第2級。介面移除Evernote登入與自訂Markboxy標題列，輸出格式只提供PNG／JPG。桌面版File →「新視窗」（Cmd/Ctrl+N）開啟獨立文件；關閉只影響該視窗，結束App時逐份確認未儲存編輯。

- 畫布按Cmd/Ctrl+V可貼入剪貼簿的PNG／JPEG圖片，沿用開檔驗證、未儲存確認及復原；檔名輸入框維持一般文字貼上。
- 畫布按Cmd/Ctrl+C，或桌面Edit → Copy，複製含底圖及標註的PNG，可貼到其他軟體；依目前裁切範圍，不含選取控制點。剪貼簿使用瀏覽器原生Clipboard API，安全來源與權限限制依環境而定；不支援時顯示錯誤，仍可匯出圖片。文字輸入框與反白文字保留一般複製。
- 「螢幕速拍」選單 →「開啟影像檔」或拖放 PNG／JPEG／`.markboxy` 文件；一次一份。圖片上限20 MiB、每邊4096像素，JPEG的EXIF旋轉由瀏覽器解碼處理。
- 畫布空白處拖曳新增箭頭；點主列矩形圖示會立即啟用矩形；圖形選單提供矩形、圓角矩形、橢圓、直線四種工具。點標註選取，拖動整體或控制點調整大小。Shift限制箭頭／直線方向為45度，或使矩形／圓角矩形／橢圓等寬高。
- 色彩、五級尺寸採原版替換式側欄；釘選後維持展開。選取標註時改該標註，未選取則設定下一個標註。
- 手機長按標註約半秒顯示臨時「刪除」選單；拖動會取消長按。桌面可右鍵，鍵盤選取後可用Shift+F10。沒有常駐刪除按鈕，刪除後不顯示通知或通知復原按鈕，使用Cmd/Ctrl+Z復原。垃圾桶維持清空整份畫布，可復原。
- Delete／Backspace刪除選取標註；Cmd/Ctrl+Z復原，Cmd/Ctrl+Shift+Z或Ctrl+Y重做。Escape取消拖曳、裁切或解除選取。編輯快捷鍵限編輯器控制項取得焦點時生效，輸入框保留文字復原。
- 縮放選單可符合視窗或使用50%～200%；放大後使用捲動，或畫布取得焦點後按住空白鍵拖曳／滑鼠中鍵拖曳平移。
- 標註拖出未裁切畫布，放開會自動延展；左／上延展同時平移底圖及所有標註。裁切後以裁切範圍顯示，標註超出時保留但裁掉輸出；重新進裁切可以取回。畫布每邊最多4096像素。
- 裁切工具提供八個控制點、尺寸欄位、框內移動、套用與取消。原圖與標註不刪除，裁切可復原或重新調整。
- 「儲存可編輯文件」或Cmd/Ctrl+S下載`.markboxy`；原生桌面版使用系統儲存視窗。可重新開啟底圖、標註及裁切；文件上限30 MiB、500個標註、100筆復原。文件不包含復原歷史。
- 底部格式可選PNG、JPEG；JPEG提供品質設定並使用白色背景。點底部匯出區、右上匯出或Cmd/Ctrl+E，輸出不含選取輪廓／控制點。圖片匯出不會把可編輯文件視為已儲存。
- 底部拖出固定使用PNG及瀏覽器DownloadURL機制；平台支援不一，點擊匯出是替代方式。

文字、手繪、圖章、PDF、舊Skitch格式、登入及雲端同步仍依規劃暫緩，尚未支援的繪圖控制項停用；登入與未支援的輸出格式已移除。沒有模擬macOS視窗圓鈕；手機布局與系統原生外框另列平台差異。

## 文件與資料保護

`.markboxy`是JSON，版本2保存文件名稱、完整尺寸、底圖Data URL、向量標註與非破壞裁切。讀取時驗證版本、有限座標、顏色、數量、內嵌圖片格式與尺寸；不載入外部圖片URL或SVG。

版本1只曾用於本次未發佈的開發測試。箭頭幾何修正後提升至版本2，避免舊文件默默改畫；不支援版本會拒絕載入並保留目前畫布，不覆寫原檔。

網頁只能確認已發起下載，無法確認磁碟寫入，所以下載後仍保留離頁提示。桌面版原子存檔成功且沒有新的編輯後才清除未儲存狀態；取消或寫入失敗保留內容。沒有承諾崩潰復原，請保存可編輯文件。

## 桌面版

本工作區供使用者開啟的最新版位於根目錄`Markboxy.app`。本次剪貼簿修正已更新該App；先前`clean-ui.dmg`未包含此批修正，若正在執行舊版，請先儲存、結束後再開根目錄版本。

需Node.js 24、Rust stable。macOS需Xcode Command Line Tools；目前最低設定macOS14，使用WebKit的Popover等原生網頁能力。Windows需Microsoft C++建置工具及WebView2。

```sh
npm run desktop:dev
# macOS arm64
npm run desktop:build -- --bundles app,dmg
# Windows，在Windows本機執行
npm run desktop:build -- --bundles nsis
```

本次將Rust最小工具鏈安裝於忽略的`.toolchains/`，沒有改動全域shell設定；使用它時先於當前終端機設定`CARGO_HOME`、`RUSTUP_HOME`及其`cargo/bin`的PATH。一般開發者可使用既有Rust安裝。

「螢幕速拍…」呼叫原生區域截圖，全域快捷鍵設定為Control+Shift+2。macOS交由系統互動選取與螢幕擷取權限處理；Windows使用原生Forms選取與實體像素座標，不繞過PowerShell執行原則。**區域截圖完成、權限拒絕／取消、快捷鍵及多螢幕尚待完整實測**，可先用系統截圖後匯入。Windows暫設桌面擷取上限6400萬像素、選區每邊4096像素，失敗會還原編輯器。

`.github/workflows/desktop.yml`僅提供手動觸發的macOS／Windows建置與未簽章安裝檔，不會推送後自動執行，也沒有建立Release。本次未上傳或執行此workflow。已產生本機arm64 App與通過hdiutil校驗的DMG，最新檔名為`Markboxy_0.2.0_aarch64-clean-ui.dmg`（位於`src-tauri/target/release/bundle/dmg/`）；尚未具備Developer ID簽章與公證，安裝流程仍待驗證。使用者目前沒有Windows環境，Windows編譯與實機驗收保留未完成。

## 驗證

```sh
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

另可用 `node tests/geometry.bench.ts` 量測純幾何路徑產生時間；它不包含Canvas繪圖與瀏覽器記憶體。

Node內建測試包含120組原版箭頭向量（五級尺寸×三種長度×八方向）、極短／無效輸入、旋轉、延展、圖形與圖片標頭、文件往返及拒絕無效輸入。120組原版輸出與新幾何的最大座標差0.000500像素，這不等於每個平台的抗鋸齒像素完全一致。

原版證據、完整圖片、雜湊、REA資料、UI狀態與實際匯出保存在本機`analysis/`，不納入網站或公開程式碼。公開測試fixture只有幾何座標，不依賴安裝Skitch。原版程式本體不打包進產品。

## 發佈

依使用者指示，後續修改只在本機實作與驗證，收到新的明確部署指示才可推送或部署。先前P0的單次部署授權不套用本次P1～P5。

既有`.github/workflows/deploy.yml`在`main`推送時測試、建置並發佈`dist/`至GitHub Pages；本次沒有推送。資源使用相對路徑，可置於`/markboxy/`子目錄。

開發持續遵守 [AGENTS.md](AGENTS.md) 的 Ponytail full。
