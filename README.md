# Emploitic Date Sorter (Unofficial)

A small extension and Tampermonkey userscript that adds a **sort by publication
date** option to Emploitic's job list:

https://emploitic.com/offres-d-emploi

## Why I built this

The site has no date sort, which makes it inconvenient looking for recent listing. 
I wanted to see the newest or oldest offers, including across all pages, without
searching page by page.

## Install

**Chrome / Edge / Brave / Opera (Chromium)**

1. Open `chrome://extensions`, `edge://extensions`, `brave://extensions`, or
   `opera://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.
4. Reload https://emploitic.com/offres-d-emploi.

**OR Tampermonkey / Violentmonkey**

1. Create a new userscript.
2. Paste the contents of `emploitic-date-sort.user.js`.
3. Save and reload the job list.

## Notes

- This is an unofficial project, not affiliated with Emploitic.
- It requests 20 offers at a time and does not bulk-download the full list.
- Only the selected sort mode is stored; no personal data is collected.


## License

Licensed under the **GNU General Public License v3.0**. See [LICENSE](./LICENSE).
