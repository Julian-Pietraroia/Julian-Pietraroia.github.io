# Stomp Pad Studio dataset

The website can collect board photos (opt-in) so a small neural network can be trained to find snowboards in photos.

```
website (opt-in checkbox) ──POST──▶ Google Apps Script ──▶ Google Drive "Stomp Pad Dataset/"
                                                               images/<id>.jpg
                                                               labels/<id>.json
                                                               Stomp Pad Dataset (sheet)
Colab notebook ◀── reads Drive ── trains ──▶ board-model.json ──▶ stomp-pad/model/
```

## 1. Turn on collection (about 5 minutes, free)

1. Go to <https://script.google.com> → **New project**. Name it "Stomp Pad collector".
2. Delete the sample code, paste in all of [`collector.gs`](collector.gs) and save.
3. **Deploy → New deployment** → type **Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   - Click **Deploy** and allow access to Drive and Sheets when asked.
4. Copy the **Web app URL** (it ends in `/exec`).
5. In `stomp-pad/index.html`, set `const DATA_ENDPOINT = '<that URL>';` and push.

The site now shows a "Help improve board detection" checkbox under the waist measurement. It is off by default, and the choice is remembered in that browser. When someone ticks it and presses **Continue**, the site sends:

| field | meaning |
|---|---|
| `image` | the photo, downscaled to 1024 px (stored as `images/<id>.jpg`) |
| `final` | nose, tail, both waist edges and the board outline, **after** the user's corrections. Coordinates are normalised 0..1. This is the ground truth. |
| `auto` | what the detector guessed before any correction, plus its waist in mm. This is the baseline. |
| `corrected` | whether the user moved any point (`true` means the detector was wrong) |
| `lengthCm`, `waistMm`, `manualWaist` | board length, final waist, and whether the waist was typed in |
| `method`, `detector` | which detector produced `auto` (`colour` or `model`) and its version |

Each submission also adds a row to the sheet, which is handy for quick charts.

To collect quickly, photograph as many different boards as you can (friends, a ski shop, rentals). Use different floors, lighting and angles, and fix the points whenever the detector is off.

## 2. Train

Open [`train_board_model.ipynb`](train_board_model.ipynb) in Google Colab (*File → Upload notebook*, or open it from GitHub) and run all cells. It:

- loads the Drive folder and shows the labelled outlines;
- scores the current colour detector against the corrected outlines (IoU and waist error);
- trains a tiny U-Net (about 40k parameters, 128×128 input) with heavy augmentation;
- compares the model with the colour detector on held-out photos, with charts for a report;
- exports `board-model.json` and checks it against a NumPy copy of the website's maths.

Train once you have at least ~30 boards; more than 100 is better.

## 3. Deploy the model

Put the file at `stomp-pad/model/board-model.json` and push. The site picks it up automatically. It shows "trained model" when the network found the board, and falls back to the colour detector when it can't.
