Source: Plus Jakarta Sans upstream repository

- Medium: https://github.com/tokotype/PlusJakartaSans/blob/master/fonts/ttf/PlusJakartaSans-Medium.ttf
- Bold: https://github.com/tokotype/PlusJakartaSans/blob/master/fonts/ttf/PlusJakartaSans-Bold.ttf
- License: https://github.com/tokotype/PlusJakartaSans/blob/master/OFL.txt
- Downloaded: 2026-06-29
- Medium SHA-256: c77bab757d7402ec6d9341d5f7ddaafb2474e17026792697ba4624c7dc89caf7
- Bold SHA-256: 5f5342ef76862b5b5365d1dff1a667629dfa484e388dd602552f647219c3870f

This file is used only by the docs Open Graph image route. The main docs
application continues to load Plus Jakarta Sans through `next/font/google`.
The Google Fonts variable TTF is not used because the current bundled
`next/og` renderer crashes while parsing its `fvar` table.
