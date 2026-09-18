# Dashboard instructions

## 1. Find your workspace

Open the [dashboard](http://127.0.0.1:3002/#canvas).

| Tab | Use it for |
| --- | --- |
| Canvas | Collection brief, style, creation settings, print sizes and artwork preview |
| Review | Resolution, visual assessment, proposed price and artwork approval |
| Pipeline | Live 17-stage workflow, individual artwork rechecks, monitoring controls and installed/configured/verified connection cards |
| Library | Original catalogue, manual Midjourney handoffs and learning information |

On a wide screen, drag a panel by its heading to move it. Use **+**, **−** and **Fit** to change the canvas zoom. The dashboard opens at 100% for readability. On smaller screens, panels stack vertically.

The studio uses a black background and layered glass cards. White text, labelled status badges and clear focus borders keep the controls readable. Decorative glow colours do not indicate completion.

For the stage map and a plain-language explanation of LangChain, LangGraph, LangSmith and the other connections, see [Pipeline and Connections](Pipeline and Connections.md). Restart monitoring only restarts status updates; it never restarts paid generation or publishes artwork.

## 2. Describe your collection

In **Creative brief**:

1. Enter a collection name, such as “Quiet Botanical Studies”.
2. Describe the artwork subject, composition and atmosphere you want.
3. In **Visual style**, choose a material and lighting direction.
4. Select the tactile-texture option if you want visible paint, paper or canvas detail in the image.

Example subject: “A single magnolia branch against a deep charcoal background, soft side lighting, restrained composition and delicate painted texture.”

Texture in an image is a visual effect. It does not add physical varnish or raised paint to a print.

## 3. Choose image count and shape

In **Render settings**, set the number of images from 1 to 50 and choose an artwork shape. FLUX now defaults to the highest native resolution for that shape, saved as PNG.

| Shape | Example ratio |
| --- | --- |
| Square | 1:1 · 2048 × 2048 pixels |
| Portrait · vertical | 4:5 · 1792 × 2240 pixels |
| Portrait · horizontal | 5:4 · 2240 × 1792 pixels |
| Landscape | 3:2 · 2496 × 1664 pixels |
| Wide landscape | 16:9 · 2560 × 1440 pixels |

The image count controls the FLUX batch after you approve a direction. Preparing directions still returns three prompt choices, not that many finished images.

Stylize, Chaos and Raw style are Midjourney prompt controls. They are not equivalent FLUX settings; the FLUX connector removes Midjourney command flags before submission.

## 4. Choose customer print sizes

Open **Print formats → Choose sizes · cm**. Tick the sizes you want to plan for. Dimensions are width × height.

Available rectangular sizes: 30 × 40, 40 × 50, 50 × 70, 60 × 90, 70 × 100, 80 × 120, 100 × 150 and 150 × 100 cm.

Available square sizes: 30 × 30, 40 × 40, 50 × 50, 60 × 60, 80 × 80 and 100 × 100 cm.

Open **Resolution targets** to see the pixels needed at 300 PPI. For example, 150 × 100 cm needs 17,717 × 11,812 pixels; 100 × 100 cm needs 11,812 × 11,812 pixels.

These are delivery targets. Selecting them does not enlarge a file, create download variants or publish Shopify options. FLUX now requests the largest exact-ratio, 16-pixel-aligned image within its documented 4 MP limit (2048 × 2048). The dimensions are shown before you approve generation. This costs more than the previous approximately 1 MP setting. Existing images and already-saved jobs keep their original dimensions.

Highest native generation resolution is not the same as a finished large-format master. Prints up to 150 × 100 cm still require separate enlargement, export and quality checking.

Different shapes may require cropping. Check the composition for each intended size; a portrait cannot become square without cropping or extending the artwork.

## 5. Prepare and approve a direction

Click **Prepare art directions**, or the **Prepare directions** button at the top. Review the three resulting candidates below the canvas.

Preparing directions does not submit a paid FLUX image-generation request.

### FLUX automatic route

1. Open **Pipeline** and click **Check connection & credits**.
2. Once the connection is verified and credits are available, return to your prepared directions.
3. Click **Approve & generate … images with FLUX** on your chosen direction. This submits a paid batch using the image count in the brief.
4. Follow its progress in **Pipeline**.
5. Completed images are saved locally and added to **Review**, where resolution inspection runs automatically.

If the dashboard reports an uncertain submission, check your BFL account history before making another request. The system does not automatically resend that paid request. Other unsubmitted images in that batch pause.

### Midjourney manual route

Choose a direction and use its copy/open controls. Create the image in Midjourney, choose your result, then paste its final public image link into the waiting-artwork area under **Library**. This is a manual handoff, not an automatic Midjourney API connection.

## 6. Review the finished artwork

In **Review**, click **Check resolution & suggest price** if the image has not been inspected. Use **Open full-size original** to examine it closely.

After the first check, use **Recheck resolution & price** to measure the file again. The results remain visible, and rechecking an unchanged approved file preserves its approved selling price. If a pending artwork's remote link fails, use **Upload original file** to import the exact PNG or JPG from your computer. The upload checks pixels and price guidance but does not approve or publish the artwork.

The resolution score measures how well the file meets 30 × 40 cm at 300 PPI. It is not an artistic score. The size rows show the resolution available for each print size and flag shape differences.

Check faces, hands, eyes, edges, unwanted marks, texture and the overall composition. Enter your own visual score from 1 to 10. A high visual score does not increase the file's pixel count.

## 7. Approve the artwork and price

1. Review or edit the product title.
2. Read the **Pricing guide**: suggested USD price, range, measured print capacity and market comparisons. Open **Why this price?** for source links and limitations. Edit **Your selling price · USD** or click **Use suggested…**. See [Pricing Guide](Pricing Guide.md) for the formula. These are retail suggestions, not guaranteed market values.
3. Enter your visual score.
4. Tick the statement confirming you inspected and approved the artwork and price.
5. Click **Approve & prepare Shopify fields**.

Use **Reject & archive** when the image is unsuitable. It leaves Pending and saves a copy under Rejected; it does not automatically generate a replacement. Approval saves a copy under Approved and enters the local Shopify queue. Existing approved prices do not change when the pricing guide is updated.

Approval records the exact inspected file, title, price and score. If the image changes, run the inspection again and make a new approval.

The older collection approval room also records selected artworks and formats. Its approval does not replace the quality-and-price decision above.

## 8. Review product information

Expand **Prepared Shopify fields** to inspect the title, description, price, SKU, tags, image description and search-engine text.

These fields are currently local drafts. Shopify upload, publication and attaching the downloadable customer file are still pending. A preview image in Shopify is not the same as a file configured for delivery after purchase.

## Common messages

| Message | What to do |
| --- | --- |
| BFL HTTP 500 | The provider connection check failed. Retry later; this does not verify or invalidate the key by itself. |
| Add credits | Check your BFL billing page. |
| Submission uncertain | Check BFL history before submitting again. |
| Needs a higher-resolution file | Prepare a larger file and inspect it again before offering that print size. |
| Different aspect ratio | Review the crop or create a matching composition. |
| Draft expired | Prepare the directions again; they are temporary until selected. |
| Publishing pending | The Shopify or digital-delivery connection is not ready. |

Refresh the page after an application update. Unsaved form entries and temporary directions may need to be entered again; recorded reviews and saved generation jobs remain on disk.
