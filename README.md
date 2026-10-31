# Emploitic Date Sorter (Unofficial)

A small extension and Tampermonkey userscript that adds a **sort by publication
date** option to Emploitic's job list:

https://emploitic.com/offres-d-emploi

## Why I built this

The site has no date sort, and featured offers are mixed with normal results.
I wanted to see the newest or oldest offers, including across all pages, without
downloading the entire job list at once.

## How it works

- **Cette page** reorders the 20 cards currently displayed.
- **Toutes les pages** shows a paginated global view, 20 offers per page.
- The native **Toutes / Pour toi** tabs stay visible in the global view.
  Clicking **Pour toi** pauses the global view; **Toutes** resumes it.

## The best way to use the extension is to combine it with the website's sidebar filters. Keyword searches may initially return unrelated job listings because the website ranks results by relevance (weighted search), 
## rather than publication date. Since the extension sorts listings by date instead of relevance, those unrelated results may appear at the top.

## Install

**Chrome / Edge / Brave / Opera (Chromium)**

1. Open `chrome://extensions`, `edge://extensions`, `brave://extensions`, or
   `opera://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.
4. Reload https://emploitic.com/offres-d-emploi.

**Tampermonkey / Violentmonkey**

1. Create a new userscript.
2. Paste the contents of `emploitic-date-sort.user.js`.
3. Save and reload the job list.

## Notes

- This is an unofficial project, not affiliated with Emploitic.
- The global view loads all matching offers once, then paginates the sorted
  result locally. Large searches are capped at 10,000 offers.
- Only the selected sort mode is stored; no personal data is collected.
- Search results follow the site's own results, including French-accented queries.

## License

Licensed under the **GNU General Public License v3.0**. See [LICENSE](./LICENSE).
