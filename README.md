# Emploitic Date Sorter (Unofficial)

A small Chrome/Edge extension and Tampermonkey userscript that adds a
**sort by publication date** option to Emploitic's job list:
https://emploitic.com/offres-d-emploi

## Why I built this

The site has no date sort, and featured offers are mixed with normal results.
I wanted to see the newest or oldest offers, including across all pages, without
downloading the entire job list at once.

## How it works

- **Cette page** reorders the 20 cards currently displayed.
- **Toutes les pages** shows a paginated global view, 20 offers per page.

The global view uses the same internal HTTP endpoints as Emploitic's own frontend,
not an official public API

## Install

**Chrome / Edge**

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.
4. Reload https://emploitic.com/offres-d-emploi.

**Tampermonkey / Violentmonkey**

1. Create a new userscript.
2. Paste the contents of `emploitic-date-sort.user.js`.
3. Save and reload the job list.

## Notes

- This is an unofficial project, not affiliated with Emploitic.
- It requests 20 offers at a time and does not bulk-download the full list.
- Only the selected sort mode is stored; no personal data is collected.
- Keyword search counts may differ slightly from the site's own results.

## License

Licensed under the **GNU General Public License v3.0**. See [LICENSE](./LICENSE).
