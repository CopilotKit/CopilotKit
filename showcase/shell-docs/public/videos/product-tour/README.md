# Product tour previews

These silent, 12-second clips start at the existing midpoint preview timestamps.
The full walkthroughs remain on Loom and load only when the visitor presses play.

| Clip                   | Loom recording                   | Start |
| ---------------------- | -------------------------------- | ----- |
| overview.mp4           | 5a04db6a04584b79b98021737d012d53 | 278s  |
| rich-threads.mp4       | 79817778d29e490c97225127d2f17b3a | 135s  |
| automatic-learning.mp4 | 2978fbfe42324e509057ac5fd46b7a70 | 214s  |

Encoding: H.264, 1280×720, 24 fps, CRF 26, no audio, MP4 faststart. Scale to
1280px wide and crop at the bottom to preserve the existing preview framing.
Regenerate the matching `public/images/product-tour/<name>.jpg` from the clip's
first frame whenever replacing a clip. MP4 and JPG files use the root Git LFS
rules; do not commit full source recordings or expiring download URLs.

```sh
ffmpeg -ss START -i SOURCE -t 12 -an \
  -vf 'scale=1280:-2,crop=1280:720:0:ih-720,fps=24' \
  -c:v libx264 -threads 2 -preset medium -crf 26 -pix_fmt yuv420p \
  -movflags +faststart NAME.mp4
ffmpeg -i NAME.mp4 -frames:v 1 -q:v 2 NAME.jpg
```
