# Markboxy

以 Skitch 2.9 為基準的圖片標註工具。這是 P0 Web 試用版：先確認主介面、細尾漸寬箭頭與操作手感，再繼續圖片匯入及圖形工具。

## 本機啟動

使用 `.node-version` 指定的 Node.js 24：

```sh
npm ci
npm run dev
```

正式建置預覽：

```sh
npm run build
npm run preview -- --port 4175
```

## 操作

- 起始提供一支校準範例箭頭；在畫布空白處拖曳可新增箭頭。
- 點箭身選取，拖曳箭身移動整支箭頭；拖曳青色端點調整。新畫好的箭頭與原版一樣不顯示選取點。
- 左側色彩及大小按鈕展開替換式色盤／五級尺寸。選擇後收起，釘選後保留。選取箭頭時套用到該箭頭，未選取時設定下一支箭頭。
- Delete／Backspace 刪除選取箭頭；Cmd/Ctrl+Z 復原，Cmd/Ctrl+Shift+Z 或 Ctrl+Y 重做。一次拖曳是一筆操作；Escape 取消拖曳或解除選取。
- 底部選單可切換縮放；底部名稱可編輯。畫布固定 1130 × 732 像素，縮放不改變輸出尺寸。
- 點底部 PNG 匯出區或右上角匯出按鈕，輸入檔名後下載 PNG。Cmd/Ctrl+E 亦可開啟匯出。匯出不含選取輪廓與控制點。
- 底部 PNG 可拖出，使用瀏覽器的 DownloadURL 機制；外部檔案拖曳依瀏覽器支援，點擊匯出是可靠替代入口。
- 上方「螢幕速拍」選單的「空白」及右上角垃圾桶可清空畫布，並可復原。

文字、圖形、繪圖、圖章、裁切、截圖、畫布延展、Evernote 登入及 PNG 以外格式尚未提供，對應控制項停用。未加入圖片匯入、可編輯專案檔及桌面包裝。

目前內容只保存在記憶體，重新整理／關閉頁面會失去編輯狀態；有修改時嘗試顯示瀏覽器離頁提示。攤平 PNG 不等於可編輯專案。原型限制為 500 支箭頭與最近 100 筆復原操作。

## 驗證

```sh
npm test
npm run build
```

Node 內建測試涵蓋原版向量校準、200 組方向／長度／尺寸、無效輸入與旋轉一致性；TypeScript 檢查包含在建置中。`tests/fixtures/skitch-arrow.json` 是無文字箭頭樣本的輪廓數據，測試不依賴本機 Skitch App。

原版與新版主布局、色盤、選取狀態的畫面及實際 PNG、操作紀錄保存在本機 `analysis/ui/`，調查材料不隨公開原始碼發佈。目前是供使用者比對的還原版，尚未宣稱所有圖示像素、五級尺寸曲線、快捷鍵及平台行為完全一致。原生系統選單、檔案對話框、瀏覽器外框與跨平台字型差異另行驗收。

## GitHub Pages

`.github/workflows/deploy.yml` 在推送到 `main` 時執行 `npm ci`、測試與建置，再透過官方 Pages Actions 發佈 `dist/`。Repository 的 Pages → Build and deployment → Source 須設定為 GitHub Actions。

建置使用相對資源路徑，可放在 Pages 的 `/markboxy/` 子目錄，沒有後端、圖片上傳或執行時套件相依。部署流程依 [GitHub 官方文件](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

開發遵守 [AGENTS.md](AGENTS.md) 的 Ponytail full，後續階段見 [PLAN.md](PLAN.md)。原版 `Skitch.app`、調查原檔、個人工具設定與環境檔都不納入公開程式碼或網站產物。
