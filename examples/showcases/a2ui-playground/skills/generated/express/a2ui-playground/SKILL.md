---
name: a2ui-playground
description: "Compose UI from the A2UI Playground catalog (CopilotKit Gen UI 2.0 standard components, charts, maps, data views, inputs, domain cards and macros) in A2UI Express. Use when an answer is better shown than told: dashboards, comparisons, forms, plans, maps."
---

## Positional Component Signatures

Use these exact positional signatures to instantiate components. Do not output property keys:
• Accordion(items, multiple?)
  - Description: Collapsible items (FAQs, details, per-file notes); each has a title and either text or a child id.
• Agenda(title?, days)
  - Description: Calendar agenda: days with timed events (conference, week plan, schedule). Prefer over Timeline for clock times.
• Alert(title, message?, tone?)
  - Description: Inline alert with icon, title and message.
  - tone: Must be one of: 'info', 'success', 'warning', 'error'
• AreaChart(title?, subtitle?, height?, format?, unit?, data, stacked?, highlight?)
  - Description: Filled trend for volumes or cumulative totals (traffic, signups); series stack. data [{x,y,series?}].
  - format: Must be one of: 'number', 'currency', 'percent', 'compact'
• AudioPlayer(url, description?)
  - Description: An audio player for an audio file URL, with the description above it.
  - url: The URL of the audio file
  - description: A title or summary of the audio, shown above the player
• Avatar(name, image?, subtitle?, size?, status?)
  - Description: Person avatar (initials if no image) with name and subtitle: authors, owners, reviewers.
  - size: Must be one of: 'sm', 'md', 'lg'
  - status: Must be one of: 'online', 'away', 'offline'
• AvatarGroup(people, max?, label?)
  - Description: Overlapping avatar stack with +N overflow: attendees, team members, reviewers.
• Badge(label, variant?, color?, size?, fontWeight?)
  - Description: A small status pill.
  - label: Badge text
  - variant: Default "soft" Must be one of: 'soft', 'solid', 'outline'
  - color: Default "secondary" Must be one of: 'secondary', 'success', 'danger', 'warning', 'info', 'discovery'
  - size: Default "md" Must be one of: 'sm', 'md', 'lg'
  - fontWeight: Default "medium" Must be one of: 'normal', 'medium', 'semibold', 'bold'
• BarChart(title?, subtitle?, height?, format?, unit?, data, stacked?, horizontal?, highlight?)
  - Description: Compare categories. data [{x,y,series?}]; series grouped side by side, or stacked:true. horizontal for long labels.
  - format: Must be one of: 'number', 'currency', 'percent', 'compact'
• Blockquote(text)
  - Description: A block quotation with a line on the left.
  - text: The quoted text, with inline markdown
• Bold(text, fontWeight?)
  - Description: Bold inline text.
  - fontWeight: Must be one of: 'normal', 'medium', 'semibold', 'bold'
• Box(children?, direction?, onVisible? (static), align?, justify?, wrap?, gap?)
  - Description: A flex container.
  - direction: Default "col" Must be one of: 'col', 'row'
  - onVisible: Sent once, the first time the container scrolls into view. Use it to load more content lazily.
  - align: Must be one of: 'start', 'center', 'end', 'baseline', 'stretch'
  - justify: Must be one of: 'start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'
  - wrap: Must be one of: 'nowrap', 'wrap', 'wrap-reverse'
  - gap: 4px steps when a number
• Button(label?, onClick? (static), text?, variant?, block?, disabled?, loading?, submit?, icon?, href?, copy?, child? (component ID), children?, color?, size?)
  - Description: A button that sends its onClick event.
  - label: The button text
  - onClick: Sent when the user clicks the button.
  - text: Same as label. Used when label is not set
  - variant: Default "default": outlined. "primary" is filled, for the one main action. "borderless" has no box, like a link Must be one of: 'default', 'primary', 'soft', 'borderless'
  - block: Full width
  - submit: Submits the Form around it. The Form sends its onSubmit event
  - icon: Lucide icon name
  - href: Opens this URL in a new tab on click, instead of onClick
  - copy: Copies this text to the clipboard on click and shows a check mark, instead of onClick
  - color: Default "primary" Must be one of: 'primary', 'secondary', 'danger'
  - size: Default "lg" Must be one of: 'sm', 'md', 'lg'
• ButtonGroup(label?, value?, options)
  - Description: Segmented single-choice control; value bound to a path.
• Callout(title?, text, icon?, actionLabel?, onAction? (static))
  - Description: Highlighted tip or note with optional emoji/icon and a call to action.
  - onAction: Fires when the call-to-action button is clicked.
• CandlestickChart(title?, subtitle?, height?, format?, unit?, data)
  - Description: OHLC price candles. data [{date,open,high,low,close}].
  - format: Must be one of: 'number', 'currency', 'percent', 'compact'
• Caption(text, color?, size?, fontWeight?, textAlign?)
  - Description: Small secondary text: a hint under a control, or a label in a Row.
  - text: Caption text
  - color: One of default|prose|primary|emphasis|secondary|tertiary|success|info|warning|caution|danger|discovery or a CSS color
  - size: Default "lg" Must be one of: 'sm', 'md', 'lg'
  - fontWeight: Default "normal" Must be one of: 'normal', 'medium', 'semibold', 'bold'
  - textAlign: Must be one of: 'start', 'center', 'end'
• Card(children?, child? (component ID), variant?, onVisible? (static), align?, justify?, wrap?, gap?, size?)
  - Description: A bordered, padded container, only for an interactive panel (controls, a form, a configurator).
  - variant: Must be one of: 'default', 'outline', 'section', 'soft', 'elevated', 'transparent'
  - onVisible: Sent once, the first time the container scrolls into view. Use it to load more content lazily.
  - align: Must be one of: 'start', 'center', 'end', 'baseline', 'stretch'
  - justify: Must be one of: 'start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'
  - wrap: Must be one of: 'nowrap', 'wrap', 'wrap-reverse'
  - gap: 4px steps when a number
  - size: The padding preset: 8, 16 or 24px. Default "md" Must be one of: 'sm', 'md', 'lg'
• Carousel(children?, activeIndex?, label?, visibleItems?, showArrows?, previousLabel?, nextLabel?, snap?, snapAlign?, onVisible? (static), align?, justify?, wrap?, gap?)
  - Description: A row that scrolls horizontally and snaps to its slides, with previous and next arrows.
  - activeIndex: The index of the slide in view. Bind it with { "@path": "/x" } to read or set it
  - label: A short name of the carousel for screen readers
  - showArrows: Default true
  - previousLabel: Default "Previous"
  - nextLabel: Default "Next"
  - snap: Must be one of: 'none', 'proximity', 'mandatory'
  - snapAlign: Must be one of: 'start', 'center', 'end'
  - onVisible: Sent once, the first time the container scrolls into view. Use it to load more content lazily.
  - align: Must be one of: 'start', 'center', 'end', 'baseline', 'stretch'
  - justify: Must be one of: 'start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'
  - wrap: Must be one of: 'nowrap', 'wrap', 'wrap-reverse'
  - gap: 4px steps when a number
• CarouselItem(children?, onVisible? (static), align?, justify?, wrap?, gap?)
  - Description: A slide of a Carousel.
  - onVisible: Sent once, the first time the container scrolls into view. Use it to load more content lazily.
  - align: Must be one of: 'start', 'center', 'end', 'baseline', 'stretch'
  - justify: Must be one of: 'start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'
  - wrap: Must be one of: 'nowrap', 'wrap', 'wrap-reverse'
  - gap: 4px steps when a number
• CarouselMediaItem(url, children?, onClick? (static), description?, href?, lightbox?, onVisible? (static), align?, justify?, wrap?, gap?, size?)
  - Description: A slide of a Carousel with an image on top and its children (a Caption, a Text) under it.
  - url: Image URL
  - onClick: Sent when the user clicks the image. It replaces the full-screen view.
  - description: What the image shows, for screen readers
  - href: Opens this URL in a new tab
  - lightbox: Default true: a click opens all slides full-screen
  - onVisible: Sent once, the first time the container scrolls into view. Use it to load more content lazily.
  - align: Must be one of: 'start', 'center', 'end', 'baseline', 'stretch'
  - justify: Must be one of: 'start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'
  - wrap: Must be one of: 'nowrap', 'wrap', 'wrap-reverse'
  - gap: 4px steps when a number
  - size: The width: "sm" 160px, "md" 240px, "lg" 320px. Default "md" Must be one of: 'sm', 'md', 'lg'
• Chart(data?, xKey?, series?, chartType?, stacked?, layout?, yAxis?, showDots?, barRadius?, innerRadius?, outerRadius?, startAngle?, endAngle?, cornerRadius?, paddingAngle?, showLabelLines?, showLegend?, showGrid?, showTooltip?, showValueLabels?, format?, currency?, title?)
  - Description: A bar, line, area, scatter, pie or donut chart.
  - data: A list of objects, or { "@path": "/x" }
  - xKey: The field of the category axis
  - series: The value fields: strings or { "key", "label"?, "color"? }. Default: every number field except xKey
  - chartType: Default "bar" Must be one of: 'bar', 'line', 'area', 'scatter', 'pie', 'donut'
  - layout: "horizontal" draws the bars from left to right. Default "vertical" Must be one of: 'vertical', 'horizontal'
  - yAxis: The value axis configuration object: {label?: string, min?: number, max?: number, width?: number}. Example: {label: "Revenue (USD)", min: 0, max: 100}. In horizontal charts, label, min and max apply to the horizontal value axis, and width sets the width of the category axis on the left.
  - showDots: Point markers on a line or area
  - barRadius: The corner radius of a bar, in pixels
  - innerRadius: Pie and donut
  - outerRadius: Pie and donut
  - startAngle: Pie and donut. Default 90
  - endAngle: Pie and donut. Default -270
  - cornerRadius: The corners of a slice
  - paddingAngle: The gap between slices
  - showLabelLines: Leader lines of the slice labels. Default true
  - showLegend: Default true
  - showGrid: Default true
  - showTooltip: Default true
  - format: Number formatting. With "percent", data values and axis min/max are fractions: 0.4 displays as 40%. For 0% to 10%, use min: 0 and max: 0.1. Must be one of: 'number', 'currency', 'percent'
  - currency: ISO code. Default "USD"
• CheckBox(label?, value?, disabled?, required?, shape?)
  - Description: A checkbox with a label.
  - label: The label text. Always set it
  - value: True when checked. Bind it with { "@path": "/x" } to read the state of the box
  - shape: Default "round" Must be one of: 'round', 'square'
• ChipSelect(label?, value?, options)
  - Description: Multi-select chips bound to a string-list path: extras, interests, dietary needs.
• ChoicePicker(label?, options?, value?, variant?, displayStyle?, filterable?, disabled?, required?)
  - Description: A list of options, as checkboxes or chips.
  - label: The visible label of the field. Always set it
  - options: Strings or { "value", "label", "description"? }
  - value: The chosen option values. Bind it with { "@path": "/x" } to a string list
  - variant: Default "mutuallyExclusive": the user picks one option Must be one of: 'multipleSelection', 'mutuallyExclusive'
  - displayStyle: Default "checkbox". "chips" shows the options as pills Must be one of: 'checkbox', 'chips'
  - filterable: Default false. Shows a field that filters the options
• Citation(index?, title?, url?, label?, snippet?, source?)
  - Description: An inline source marker ([1]) that shows the source on hover or click: the title, a snippet and a link.
  - index: The marker number. Default 1
  - title: The source title
  - url: The source URL (http, https)
  - label: Marker text instead of the number, for example a domain
  - snippet: The quoted passage, one or two lines
  - source: The publisher or domain. Default: the host of url
• Code(text, language?)
  - Description: A block of code in a monospace font.
  - text: Source code
• CodeBlock(code, language?, filename?)
  - Description: Syntax-colored code with language label and copy button. Use for any code, config, command or diff snippet.
• Column(children?, onVisible? (static), align?, justify?, wrap?, gap?)
  - Description: A vertical flex container.
  - onVisible: Sent once, the first time the container scrolls into view. Use it to load more content lazily.
  - align: Must be one of: 'start', 'center', 'end', 'baseline', 'stretch'
  - justify: Must be one of: 'start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'
  - wrap: Must be one of: 'nowrap', 'wrap', 'wrap-reverse'
  - gap: 4px steps when a number
• Combobox(label?, value?, options, placeholder?)
  - Description: Searchable dropdown for long option lists (countries, cities, timezones).
• ComparisonTable(title?, options, rows, highlight?)
  - Description: Feature matrix comparing options side by side; values may be true/false/text; highlight marks the recommended option.
• DataTable(title?, columns, rows, searchable?, pageSize?)
  - Description: Sortable, filterable table (TanStack Table). columns [{key,label,format?}], rows are objects keyed by column key.
• DatePicker(label?, value?, placeholder?)
  - Description: Date picker with calendar popover; value ISO date bound to a path.
• DateTimeInput(label?, value?, enableDate?, enableTime?, timeStep?, min?, max?, placeholder?, disabled?, required?, clearable?, block?)
  - Description: A date picker, or a time picker with enableTime, or both.
  - label: The visible label of the field. Always set it
  - value: ISO 8601: "YYYY-MM-DD", "HH:MM" or "YYYY-MM-DDTHH:MM". Bind it with { "@path": "/x" }
  - enableDate: The user picks a date. Default true unless only enableTime is set
  - enableTime: The user picks a time
  - timeStep: Minutes between the times the user can pick, e.g. 15 or 30. Shows the time as a list
  - min: The earliest value, ISO 8601
  - max: The latest value, ISO 8601
  - block: Full width
• Divider(axis?, spacing?, color?, size?)
  - Description: A line between two groups: horizontal, or vertical with axis "vertical" in a Row.
  - axis: Default "horizontal" Must be one of: 'horizontal', 'vertical'
  - color: Must be one of: 'default', 'subtle', 'strong', 'info', 'warning', 'caution', 'success', 'danger', 'discovery'
• EmptyState(title, description?, icon?, actionLabel?, onAction? (static))
  - Description: Empty or zero-results state with icon, title, hint and optional action: no matches, nothing scheduled, inbox zero.
  - onAction: Fires when the action button is clicked.
• EntityCard(title, actions?, onAction? (static), onClick? (static), subtitle?, description?, image?, imageAspectRatio?, meta?, badge?, rating?, ratingCount?, href?, layout?)
  - Description: A card for one thing (a product, place, person or listing): an image, title, subtitle, description, a price or meta line, a badge, a rating and up to three buttons.
  - title: The name
  - actions: Up to three buttons. A button without href sends onAction with its label
  - onAction: Sent when the user clicks a button without href. The args carry the label of the button.
  - onClick: Sent when the user clicks the card and it has no href.
  - subtitle: A second line, for example the brand or category
  - description: Up to three lines
  - image: An image URL
  - imageAspectRatio: Default "4 / 3"
  - meta: A short fact line, for example "$29 / month" or "Open until 22:00"
  - rating: 0 to 5, shown as stars
  - ratingCount: The number of ratings
  - href: Opens this URL in a new tab when the user clicks the card
  - layout: Default "vertical". "horizontal" puts the image on the left Must be one of: 'vertical', 'horizontal'
• EventCard(title, date, time?, venue?, host?, description?, attendees?, image?, tags?, actionLabel?, onAction? (static))
  - Description: Event: date block, title, time, venue, host, attendees count, tags, RSVP action. Lead an event or conference with it.
  - onAction: Fires when the RSVP button is clicked.
• Favicon(url, alt?, size?)
  - Description: The favicon of the site at a URL.
  - size: Pixels. Default 16
• FlashcardFlip(front?, back?, hint?)
  - Description: A card that shows the front text.
  - front: The text on the front
  - back: The text on the back
  - hint: A small line under the front, for example "Click to flip"
• FlightCard(airline, flightNumber?, from, to, fromCity?, toCity?, depart, arrive, duration?, stops?, price?, cabin?, date?, badge?, actionLabel?, onAction? (static))
  - Description: Flight itinerary: airline, flight number, origin and destination codes with times, duration, stops, price and a select button. One per flight option. Macro: expands into standard components.
  - onAction: Fires when the flight is selected.
• Flow(children?, columns?, rows?, layout?, onVisible? (static), align?, justify?, wrap?, gap?)
  - Description: A masonry-like grid that packs cells of different sizes.
  - layout: Default "pack" Must be one of: 'pack', 'fixed'
  - onVisible: Sent once, the first time the container scrolls into view. Use it to load more content lazily.
  - align: Must be one of: 'start', 'center', 'end', 'baseline', 'stretch'
  - justify: Must be one of: 'start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'
  - wrap: Must be one of: 'nowrap', 'wrap', 'wrap-reverse'
  - gap: 4px steps when a number
• FlowItem(children?, span?, rowSpan?, aspectMode?, onVisible? (static), align?, justify?, wrap?, gap?)
  - Description: A cell of a Flow, with an optional span.
  - aspectMode: Must be one of: 'soft', 'fixed'
  - onVisible: Sent once, the first time the container scrolls into view. Use it to load more content lazily.
  - align: Must be one of: 'start', 'center', 'end', 'baseline', 'stretch'
  - justify: Must be one of: 'start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'
  - wrap: Must be one of: 'nowrap', 'wrap', 'wrap-reverse'
  - gap: 4px steps when a number
• FollowUp(items?, onFollowUp? (static), title?)
  - Description: Suggested next prompts as pills.
  - items: Strings or { "label", "message"? }, or { "@path": "/x" }
  - onFollowUp: Sent when the user clicks a pill. The args carry the message of the pill.
  - title: A caption above the pills
• Form(children?, onSubmit? (static), label?, align?, justify?, wrap?, gap?)
  - Description: A layout container that is a form.
  - onSubmit: Sent when the user submits the form.
  - label: A short name of the form for screen readers
  - align: Must be one of: 'start', 'center', 'end', 'baseline', 'stretch'
  - justify: Must be one of: 'start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'
  - wrap: Must be one of: 'nowrap', 'wrap', 'wrap-reverse'
  - gap: 4px steps when a number
• Gauge(title?, value, min?, max?, label?, format?)
  - Description: Half-ring gauge for a single value within min..max (score, utilization).
  - format: Must be one of: 'number', 'currency', 'percent', 'compact'
• Grid(children?, columns?, minChildWidth?, rows?, onVisible? (static), align?, justify?, wrap?, gap?)
  - Description: A CSS grid container.
  - columns: Column count or CSS template. Default 2
  - onVisible: Sent once, the first time the container scrolls into view. Use it to load more content lazily.
  - align: Must be one of: 'start', 'center', 'end', 'baseline', 'stretch'
  - justify: Must be one of: 'start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'
  - wrap: Must be one of: 'nowrap', 'wrap', 'wrap-reverse'
  - gap: 4px steps when a number
• GridItem(children?, span?, rowSpan?, onVisible? (static), align?, justify?, wrap?, gap?)
  - Description: A cell of a Grid, with an optional span.
  - onVisible: Sent once, the first time the container scrolls into view. Use it to load more content lazily.
  - align: Must be one of: 'start', 'center', 'end', 'baseline', 'stretch'
  - justify: Must be one of: 'start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'
  - wrap: Must be one of: 'nowrap', 'wrap', 'wrap-reverse'
  - gap: 4px steps when a number
• Heading(text, eyebrow?, subtitle?, level?)
  - Description: Surface title with optional eyebrow and subtitle. Start most surfaces with one.
  - level: Must be one of: '1', '2', '3'
• Heatmap(title?, subtitle?, height?, format?, unit?, data)
  - Description: Matrix of values, e.g. day x hour. data [{x,y,value}] with x,y categories.
  - format: Must be one of: 'number', 'currency', 'percent', 'compact'
• HtmlView(html, title?)
  - Description: Raw HTML in a fully sandboxed iframe: no scripts, no same-origin access.
• Icon(name, label?, size?, color?, strokeWeight?)
  - Description: A Lucide icon by kebab-case name (for example "arrow-right"), or an A2UI icon name (for example "arrowBack").
  - name: A Lucide icon name in kebab-case ("arrow-right"), an A2UI icon name ("arrowBack"), or { "svgPath" } on a 24px grid
  - label: What the icon means, for screen readers. Leave it unset when text next to the icon says the same
  - size: Default "md" Must be one of: 'sm', 'md', 'lg', 'xl'
  - strokeWeight: The stroke width Must be one of: 'normal', 'medium', 'semibold', 'bold'
• Image(url, description?, onOverlayClick? (static), variant?, lightbox?, actionOverlay?)
  - Description: An image from a URL.
  - url: Image URL
  - description: What the image shows, for screen readers. Leave it unset only for a decorative image
  - onOverlayClick: Sent when the user clicks the actionOverlay button and it has no href.
  - variant: The size: "icon" 24px, "avatar" 40px round, "smallFeature" 160px wide, "largeFeature" and "header" full width. Default "mediumFeature": the natural size Must be one of: 'icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'
  - lightbox: Default true: a click opens the image full-screen
  - actionOverlay: A button over the bottom-right corner of the image. Without href, it sends onOverlayClick
• ImageGallery(images, columns?)
  - Description: Grid of images with captions.
• ImageGrid(images?, columns?, layout?, gap?)
  - Description: A gallery of images in a grid.
  - images: A list of { "url", "description"?, "caption"?, "href"? }, or { "@path": "/x" }
  - columns: Default 3
  - layout: Default "grid". "bento" makes the first image twice as large Must be one of: 'grid', 'bento'
  - gap: Default 2
• Italic(text)
  - Description: Italic inline text.
• Kbd(keys, label?)
  - Description: Keyboard shortcut chips, e.g. keys ['Cmd','K'] with a label. Use for shortcuts and how-to steps.
• KeyValueList(title?, items, columns?)
  - Description: Label/value rows, e.g. specs or order details.
• Label(text, htmlFor?, color?, size?, fontWeight?, textAlign?)
  - Description: The label of a form field.
  - text: Label text
  - color: One of default|prose|primary|emphasis|secondary|tertiary|success|info|warning|caution|danger|discovery or a CSS color
  - size: Default "sm" Must be one of: '3xs', '2xs', 'xs', 'sm', 'md', 'lg'
  - fontWeight: Default "medium" Must be one of: 'normal', 'medium', 'semibold', 'bold'
  - textAlign: Must be one of: 'start', 'center', 'end'
• LineChart(title?, subtitle?, height?, format?, unit?, data, curve?, highlight?)
  - Description: Trend over ordered x. data [{x,y,series?}]; one line per series.
  - format: Must be one of: 'number', 'currency', 'percent', 'compact'
• Link(text, href, title?)
  - Description: A link.
  - text: Link text
  - href: URL
• LinkCard(href, title, onClick? (static), description?, image?, domain?, favicon?)
  - Description: A preview card of a URL: the favicon and domain, the title, a description and a thumbnail.
  - href: The URL (http, https)
  - title: The page title
  - onClick: Sent when the user clicks the card, instead of the link.
  - description: One or two lines
  - image: A thumbnail URL
  - domain: Shown next to the favicon. Default: the host of href
  - favicon: Default true
• List(items?, children?, action? (static), direction?, marker?, connector?, start?, maxMarkerSize?, align?, gap?)
  - Description: A list in a Card or next to another component.
  - items: Strings or { "label", "value"?, "description"?, "icon"? }, or { "@path": "/x" }
  - action: Runs when the user picks an item. The args are the index, label and value of the item.
  - direction: Default "vertical". "horizontal" scrolls sideways Must be one of: 'vertical', 'horizontal'
  - marker: Default "bullet" Must be one of: 'bullet', 'number', 'rich', 'none'
  - connector: Default "none" Must be one of: 'none', 'solid'
  - start: The first number of marker "number"
  - maxMarkerSize: The width of the marker column in pixels
  - align: Must be one of: 'start', 'center', 'end', 'stretch'
• ListItem(label?, value?, action? (static), children?, description?, icon?, marker?, markerSize?, disabled?)
  - Description: An item of a List, with a label, a value on the right, a description, an icon and children.
  - value: Without an action: shown on the right of the label, for a key and value fact
  - action: Runs when the user picks the item.
  - icon: Lucide icon name
  - marker: Shows this text as the marker
  - markerSize: The width of the marker column in pixels
  - disabled: Greys the item out and ignores its action
• LocationCard(name, address?, lat, lon, category?, rating?, hours?)
  - Description: Single place (venue, hotel, office): mini map, name, address, category, rating, actions. Use instead of MapView for one place.
• Map(markers?, selected?, route?, zoom?, center?)
  - Description: A map with markers.
  - markers: A list of places, or { "@path": "/x" }
  - selected: The label of the selected marker. Bind it with { "@path": "/x" } to read the choice of the user
  - route: Draws a line through the markers in order
  - zoom: With two or more markers, only the highest zoom of the fit
• MapView(title?, markers, height?, zoom?)
  - Description: Interactive dark map (MapLibre) with numbered markers; fits all markers. markers [{name,lat,lon,description?}].
• Markdown(text, streaming?)
  - Description: A block of GitHub-flavored markdown.
  - text: Markdown source
  - streaming: Default false
• Math(value, block?)
  - Description: A TeX math formula, typeset with KaTeX.
  - value: TeX source
  - block: Default false
• Modal(trigger? (component ID), content? (component ID), title?, open?)
  - Description: A dialog over the page.
  - title: The heading of the dialog
  - open: Default false. Bind it with { "@path": "/x" } to read it
• PieChart(title?, subtitle?, height?, format?, unit?, data, donut?, centerLabel?)
  - Description: Part-to-whole. data [{label,value}]; donut:true for a ring with center total.
  - format: Must be one of: 'number', 'currency', 'percent', 'compact'
• PlaceList(title?, places, source?, selected?, height?, basemap?)
  - Description: Split view: ranked list of places linked to a map; hovering/clicking a row highlights its marker. selected (row index) starts with that row highlighted.
  - basemap: Must be one of: 'dark', 'streets', 'liberty'
• Popover(children?, open?, showOnHover?, hoverOpenDelay?)
  - Description: A small overlay next to a trigger.
  - open: Default false
  - hoverOpenDelay: Milliseconds before a hover opens it. Default 0
• PopoverContent(children?, side?, sideOffset?, align?)
  - Description: The body of a Popover.
  - side: Default "bottom" Must be one of: 'top', 'bottom', 'left', 'right'
  - sideOffset: Pixels between the trigger and the content. Default 6
  - align: Default "center" Must be one of: 'start', 'center', 'end'
• PopoverTrigger(children?, block?)
  - Description: The trigger of a Popover.
  - block: Full width
• Pressable(children?, onClick? (static), href?, disabled?, tooltip?, ariaPressed?, onVisible? (static), align?, justify?, wrap?, gap?, hoverBackground?, insetBorder?)
  - Description: A layout container that the user can click or press with Enter or Space.
  - onClick: Sent when the user clicks or presses the container.
  - href: Opens this URL in a new tab on click, instead of onClick
  - tooltip: Shown on hover
  - ariaPressed: For a toggle
  - onVisible: Sent once, the first time the container scrolls into view. Use it to load more content lazily.
  - align: Must be one of: 'start', 'center', 'end', 'baseline', 'stretch'
  - justify: Must be one of: 'start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'
  - wrap: Must be one of: 'nowrap', 'wrap', 'wrap-reverse'
  - gap: 4px steps when a number
  - insetBorder: A 1px border inside the box
• ProductCard(name, price, compareAt?, image?, rating?, reviews?, badge?, specs?, actionLabel?, onAction? (static))
  - Description: Product tile: name, price (and compare-at), rating, short specs, badge, buy button. One per item when comparing products. Macro: expands into standard components.
  - onAction: Fires when the buy button is clicked.
• ProfileCard(name, role?, company?, avatar?, location?, bio?, email?, phone?, website?, tags?, stats?)
  - Description: Person card: avatar, name, role, company, location, bio, contacts, tags, stats. Use for team members, speakers, candidates.
• Progress(label?, value, caption?, tone?)
  - Description: Labelled progress bar, value 0-100: goals, budgets used, completion, coverage.
  - tone: Must be one of: 'default', 'positive', 'negative', 'warning', 'info', 'accent'
• PulseIndicator(label?, pulseColor?, duration?, endScale?, startOpacity?, color?, size?)
  - Description: A small dot that pulses, for example next to the text "Live".
  - label: What the dot means, for screen readers. Leave it unset when text next to the dot says the same
  - duration: Milliseconds. Default 1500
  - endScale: Default 2.4
  - startOpacity: Default 0.6
  - color: Text color token. Default "success"
  - size: Pixels. Default 12
• Quote(text, author?, role?)
  - Description: Pull quote with attribution: testimonial, review, reviewer comment.
• RadarChart(title?, subtitle?, height?, format?, unit?, data, max?)
  - Description: Multi-axis profile (scores per criterion for 2-3 options or people). data [{axis,value,series?}], values on a shared scale.
  - format: Must be one of: 'number', 'currency', 'percent', 'compact'
• RadialProgress(label?, value, display?, tone?)
  - Description: Ring with centered value, value 0-100: a single score or percent complete.
  - tone: Must be one of: 'default', 'positive', 'negative', 'warning', 'info', 'accent'
• Radio(label?, value?, disabled?, required?)
  - Description: One radio button.
• RadioGroup(label?, options?, value?, direction?, variant?, disabled?, required?)
  - Description: A group of radio buttons.
  - label: The visible label of the field. Always set it
  - options: Strings or { "value", "label", "description"? }
  - value: Bind it with { "@path": "/x" } to read what the user entered
  - direction: Default "row" Must be one of: 'row', 'col'
  - variant: Must be one of: 'list', 'pills', 'cards'
• Rating(value, count?, label?)
  - Description: Star rating (0-5) with optional review count: products, places, reviews.
• ReceiptCard(merchant, orderId?, date?, status?, items, currency?, tax?, shipping?, discount?, payment?)
  - Description: Order receipt: merchant, order id, date, line items with qty and price, subtotal/tax/total, status.
• RecipeCard(title, image?, time?, servings?, difficulty?, ingredients, steps, tags?)
  - Description: Recipe: title, time/servings/difficulty, ingredient checklist and numbered steps. Use for any recipe or cooking how-to.
• RouteMap(title?, from, to, coordinates, distance?, duration?, height?)
  - Description: Map with a route line through coordinates [[lon,lat],...] plus start/end pins and distance/duration.
• Row(children?, onVisible? (static), align?, justify?, wrap?, gap?)
  - Description: A horizontal flex container.
  - onVisible: Sent once, the first time the container scrolls into view. Use it to load more content lazily.
  - align: Must be one of: 'start', 'center', 'end', 'baseline', 'stretch'
  - justify: Must be one of: 'start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'
  - wrap: Must be one of: 'nowrap', 'wrap', 'wrap-reverse'
  - gap: 4px steps when a number
• SankeyChart(title?, subtitle?, height?, format?, unit?, links)
  - Description: Flows between stages, e.g. budget or funnel paths. links [{source,target,value}].
  - format: Must be one of: 'number', 'currency', 'percent', 'compact'
• ScatterChart(title?, subtitle?, height?, format?, unit?, data, xLabel?, yLabel?)
  - Description: Relationship between two numbers (price vs rating, effort vs impact). data [{x,y,label?,size?,series?}].
  - format: Must be one of: 'number', 'currency', 'percent', 'compact'
• Section(eyebrow?, title, description?, children)
  - Description: Titled group with eyebrow, title, description, and children.
• SegmentedControl(label?, options?, value?, block?, variant?, disabled?, size?)
  - Description: A row of segments.
  - label: The visible label of the field. Always set it
  - options: Strings or { "value", "label", "description"? }
  - value: Bind it with { "@path": "/x" } to read what the user entered
  - block: Full width
  - variant: Default "ghost" Must be one of: 'solid', 'soft', 'outline', 'ghost'
  - size: Default "lg" Must be one of: 'sm', 'md', 'lg', 'xl'
• Select(label?, options?, value?, placeholder?, required?, disabled?, clearable?, clearLabel?, searchable?, icon?, block?, size?)
  - Description: A dropdown list of options.
  - label: The visible label of the field. Always set it
  - options: Strings or { "value", "label", "description"? }
  - value: Bind it with { "@path": "/x" } to read what the user entered
  - clearLabel: The label of the empty option
  - icon: Lucide icon shown before the value
  - block: Full width
  - size: Default "xl" Must be one of: 'sm', 'md', 'lg', 'xl'
• ShimmerText(text, color?, fontWeight?, textAlign?, tabularNums?, size?)
  - Description: Text with a moving shimmer.
  - color: One of default|prose|primary|emphasis|secondary|tertiary|success|info|warning|caution|danger|discovery or a CSS color
  - fontWeight: Must be one of: 'normal', 'medium', 'semibold', 'bold'
  - textAlign: Must be one of: 'start', 'center', 'end'
  - size: Default "md" Must be one of: '3xs', '2xs', 'xs', 'sm', 'md', 'lg'
• Skeleton(lines?, variant?)
  - Description: Loading placeholder lines/blocks.
  - variant: Must be one of: 'text', 'card', 'chart'
• Slider(label?, value?, min?, max?, step?, steps?, unit?, marks?, sliderStyle?, disabled?)
  - Description: A range slider for a number between min and max.
  - label: The visible label of the field. Always set it
  - value: Bind it with { "@path": "/x" } to read the number
  - min: Default 0
  - max: Default 100
  - step: Default 1
  - steps: The number of equal divisions between min and max, instead of step
  - unit: Unit after the value, for example "%"
  - sliderStyle: Default "continuous" Must be one of: 'continuous', 'discrete'
• Spacer()
  - Description: Flexible empty space.
• Sparkline(label?, values, value?, delta?, tone?)
  - Description: Tiny trend with label and latest value; a compact KPI with history, fits in a Grid instead of Stat. values: numbers.
  - tone: Must be one of: 'positive', 'negative', 'default'
• Stat(label, value, delta?, trend?, caption?, tone?, icon?)
  - Description: One numeric KPI: label, short value (number or <10 chars like '$84k'), optional delta (e.g. '+4.2%'), caption. Not for sentences.
  - trend: Must be one of: 'up', 'down', 'flat'
  - tone: Must be one of: 'default', 'positive', 'negative', 'warning', 'info', 'accent'
• StatGroup(items)
  - Description: Compact strip of several KPIs in one card.
• StockTicker(symbol, name?, price, change?, changePct?, currency?, series?, stats?, sample?)
  - Description: Stock quote header: symbol, name, price, change and % change, sparkline, key stats. sample:true labels illustrative data.
• Strikethrough(text)
  - Description: Struck-through inline text.
• Svg(paths?, viewBox?, label?, fill?, stroke?, strokeWidth?, strokeLinecap?, strokeLinejoin?, preserveAspectRatio?, circles?, rects?, lines?, texts?, size?, color?)
  - Description: A vector drawing from primitive shapes (paths, circles, rects, lines, texts).
  - label: What the drawing shows, for screen readers. Leave it unset for a decorative drawing
  - fill: Default "currentColor"
  - strokeLinecap: Must be one of: 'butt', 'round', 'square'
  - strokeLinejoin: Must be one of: 'miter', 'round', 'bevel'
  - color: Default "prose"
• Switch(label, value?, description?)
  - Description: On/off toggle with label and description.
• Table(columns?, rows?, children?, caption?, columnSizing?, dividers?, stickyHeader?, emptyLabel?, cellComponents?)
  - Description: A data table.
  - columns: Strings, { "label", "align"?, "width"?, "componentId"? } or { "componentId" }, or { "@path": "/x" }. Default []
  - rows: A list of row lists, or { "@path": "/x" }. A cell is a string, a number, or { "componentId": "<id>" } to show a component. Default []
  - caption: A short name of the table for screen readers. It is not shown
  - columnSizing: Default "auto" Must be one of: 'auto', 'equal'
  - dividers: Default true
  - stickyHeader: Default false
  - emptyLabel: Default "No rows"
• TableCell(text?, children?, header?, vAlign?, colSpan?, rowSpan?, align?)
  - Description: A cell of a TableRow.
  - vAlign: Default "start" Must be one of: 'start', 'center', 'end'
  - align: Must be one of: 'start', 'center', 'end'
• TableRow(children?, label?, header?, labelColSpan?)
  - Description: A row of a Table.
  - label: The text of a header cell at the start of the row
  - labelColSpan: Columns the label cell spans
• TableSection(children?, header?, rowDivider?)
  - Description: A group of TableRow children in a Table.
  - header: Renders the rows as the header
• Tabs(tabs, selectedIndex?)
  - Description: Tabs that show one panel at a time.
  - tabs: One entry per tab
  - selectedIndex: The open tab. Default 0. Bind it with { "@path": "/x" } to read it
• TagList(tags, tone?)
  - Description: Wrapping list of tags/chips.
  - tone: Must be one of: 'default', 'positive', 'negative', 'warning', 'info', 'accent'
• Text(text?, children?, color?, fontWeight?, textAlign?, tabularNums?, size?, strong?)
  - Description: Body text inside a Card or next to another component.
  - text: Text with inline markdown. A bound number shows as text
  - color: One of default|prose|primary|emphasis|secondary|tertiary|success|info|warning|caution|danger|discovery or a CSS color
  - fontWeight: Must be one of: 'normal', 'medium', 'semibold', 'bold'
  - textAlign: Must be one of: 'start', 'center', 'end'
  - size: Default "md" Must be one of: '3xs', '2xs', 'xs', 'sm', 'md', 'lg'
  - strong: Default false
• TextArea(label?, value?, placeholder?, rows?, maxRows?, autoResize?, required?, disabled?, invalid?, size?)
  - Description: A multi-line text input.
  - label: The visible label of the field. Always set it
  - value: Bind it with { "@path": "/x" } to read what the user entered
  - rows: Default 3
  - size: Default "xl" Must be one of: 'sm', 'md', 'lg', 'xl'
• TextField(label?, value?, placeholder?, variant?, required?, disabled?, invalid?, size?)
  - Description: A text input, single-line unless variant is "longText".
  - label: The visible label of the field. Always set it
  - value: Bind it with { "@path": "/x" } to read what the user typed
  - variant: Default "shortText". "longText" is a multi-line field, "obscured" a password Must be one of: 'shortText', 'longText', 'number', 'obscured', 'email', 'url', 'tel'
  - size: Default "xl" Must be one of: 'sm', 'md', 'lg', 'xl'
• Timeline(items)
  - Description: Vertical timeline of dated events or steps with status.
• Title(text, color?, fontWeight?, textAlign?, tabularNums?, size?, strong?)
  - Description: A heading inside a Card or next to another component.
  - text: Heading text
  - color: One of default|prose|primary|emphasis|secondary|tertiary|success|info|warning|caution|danger|discovery or a CSS color
  - fontWeight: Must be one of: 'normal', 'medium', 'semibold', 'bold'
  - textAlign: Must be one of: 'start', 'center', 'end'
  - size: Default "md" Must be one of: 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'
  - strong: Default true
• Tooltip(trigger? (component ID), content? (component ID))
  - Description: Shows `content` when the user points at `trigger` or moves keyboard focus to it.
• Treemap(title?, subtitle?, height?, format?, unit?, data)
  - Description: Nested part-to-whole as rectangles. data [{name,value,group?}].
  - format: Must be one of: 'number', 'currency', 'percent', 'compact'
• Underline(text)
  - Description: Underlined inline text.
• Video(url, title?, captions?, posterUrl?)
  - Description: A video player for a video file URL (with optional captions), or a YouTube link in privacy-enhanced mode: the poster shows first, and the player loads when the user presses play.
  - url: The URL of a video file, or of a YouTube video or short. A page on another video site shows as a link
  - title: Names the video for screen readers
  - captions: Caption tracks of a video file
  - posterUrl: The image shown before the video plays
• VideoEmbed(url, title?)
  - Description: Embedded YouTube/Vimeo video by URL.
• WeatherCard(location, temp, condition, icon?, high?, low?, feels?, humidity?, wind?, unit?, hourly?, daily?)
  - Description: Current weather hero with condition icon, temp, high/low, details, an hourly strip and daily forecast. icon: sun|cloud-sun|cloud|fog|drizzle|rain|snow|storm.
  - unit: Must be one of: 'C', 'F'
• WeatherReport(location, unit?)
  - Description: Live weather for a place: current conditions, the next 12 hours as a chart and a 7-day forecast. Write only the place, for example WeatherReport("Lisbon"): the server fetches the forecast. Macro: expands into standard components.
  - unit: Must be one of: 'C', 'F'

## Positional Function Signatures

Use these exact positional signatures to instantiate check rules or logic functions:
• and(values)
  - Description: True when every value is true
• calc(expression)
  - Description: The value of an arithmetic expression over the other args, by name: + - * / % ( ), comparisons, && || !, cond ? a : b, min max round floor ceil abs, 'text' + name
• email(value)
  - Description: Valid when the value is an email address
• formatCurrency(value, currency, decimals?, grouping?)
  - Description: The amount as money, with an ISO 4217 currency code
• formatDate(value, format)
  - Description: A date or ISO string in a TR35 pattern, for example "MMM d, yyyy" or "HH:mm"
• formatNumber(value, decimals?, grouping?)
  - Description: The number in the locale of the user
• formatString(value)
  - Description: Interpolates ${/path}, ${relative/path} and ${fn(arg: value)} in the value; \${ is a literal
• length(value, min?, max?)
  - Description: Valid when the length of the value is within min and max
• not(value)
  - Description: The negated value
• numeric(value, min?, max?)
  - Description: Valid when the value is a number within min and max
• openUrl(url)
  - Description: Opens an http(s) URL in a new tab. Only from an event
• or(values)
  - Description: True when any value is true
• pluralize(value, zero?, one?, two?, few?, many?, other)
  - Description: The string of the plural category of the value
• regex(value, pattern)
  - Description: Valid when the value matches the pattern
• required(value)
  - Description: Valid when the value is not empty
• series(count, item, variable?, start?)
  - Description: A list of count copies of item, for chart data and template lists. Put arithmetic in ${expression} strings in item, using the loop variable (default i, counting from start, default 1) and other named args. A whole-expression string retains the result type, so "${i * monthlyCost}" yields a number. Arguments, including nested calc or formatString calls in item, resolve before the series loop; those calls cannot use the loop variable. Example: {"@call":"series","args":{"count":6,"item":{"month":"${i}","cost":"${i * monthlyCost}"},"monthlyCost":{"@path":"/monthlyCost"}}}. Omit variable to use i.

## Catalog Instructions

## Design rules

- Fully answer the request. Lead with a Heading, then the component built for the job: comparisons -> ComparisonTable, plans/options -> RadioGroup or ProductCard, schedules -> Agenda or Timeline, code -> CodeBlock, people -> ProfileCard or Avatar/AvatarGroup, statuses -> Badge, ratings -> Rating, a single ratio or score -> RadialProgress or Gauge, recipes -> RecipeCard, events -> EventCard, products -> ProductCard, flights -> FlightCard, weather -> WeatherCard. Pick the richest component that fits: charts for numbers over time or comparisons, MapView for places, DataTable for many rows, Timeline for sequences, domain cards when they match.
- Layout with Column, Row and Grid. Use Card only for an interactive panel (a form, controls) and Section to group with a title. Short text is Text, Title or Caption; prose is Markdown.
- Make the layout make sense: one chart per question unless the user asks for more, never two charts or a chart plus a table showing the same numbers, and never a chart whose series is flat or has under 3 points (use a Stat instead).
- Put KPIs in a Grid of Stat (add a Sparkline when a trend matters). Aim for 8 to 18 components, never more than 20: show each fact once (never the same list in both a map and a table), prefer one rich component over many small ones, but use small ones (Badge, Avatar, Divider) where they carry meaning.
- Concise copy, specific realistic data. If numbers are illustrative (no live source), end with a Caption saying "Illustrative data".
- Multi-series charts share one axis: only combine series of similar magnitude. Otherwise plot % change from a common start, or use one chart per series.
- Percent values are 0-100 (12.4 means 12.4%) with format "percent"; never fractions.
- Subtitles describe the content ("Revenue grew 12% on EMEA renewals"), never the UI itself.
- Maps: at most 8 markers, each a specific named place (landmark, venue, neighbourhood) that the plan text mentions, one per stop. Never use the city itself as a marker.
- Stat values are short numbers; put qualitative takeaways in KeyValueList, Callout or Markdown.
- Write final copy. Never say "placeholder", "sample text" or "lorem". Never use em dashes.

### Examples:

<a2ui>
surface("sales-dashboard")
$/form/email = ""
root = Column([head, kpis, chart, form, note], _, _, _, _, 3)
head = Heading("Q3 sales by region", "Sales dashboard", "Revenue grew 11% on EMEA renewals")
kpis = Grid([k1, k2, k3], 3)
k1 = Stat("Revenue", "$18.4M", "+11.2%", "up")
k2 = Stat("Units sold", "128k", "+8.4%", "up")
k3 = Stat("Quota attainment", "104%", "+3 pts", "up")
chart = BarChart("Revenue by region", _, _, "currency", _, [{x: "NA", y: 7.1}, {x: "EMEA", y: 5.2}, {x: "APAC", y: 3.9}, {x: "LATAM", y: 2.2}])
form = Card([ft, email, send])
ft = Title("Get the weekly report", _, _, _, _, "md")
email = TextField("Work email", $/form/email)
send = Button("Subscribe", Event("subscribe", {email: $/form/email}), _, "primary")
note = Caption("Illustrative data")
</a2ui>

<a2ui>
surface("product-comparison")
root = Column([head, grid], _, _, _, _, 3)
head = Heading("Noise-cancelling headphones", "Compare", "Three picks under $400, best value first")
grid = Grid([p1, p2, p3], 3)
p1 = ProductCard("Studio Wireless", "$249", "$329", _, 4.6, _, "Best value", ["Adaptive noise cancelling", "40 h battery"], _, Event("add_to_cart", {sku: "studio"}))
p2 = ProductCard("Aria Pro 2", "$349", _, _, 4.8, _, "Top rated", ["Best-in-class ANC", "Spatial audio"], _, Event("add_to_cart", {sku: "aria"}))
p3 = ProductCard("Fold Lite", "$129", _, _, 4.2, _, _, ["Foldable, 190 g", "50 h battery"], _, Event("add_to_cart", {sku: "fold"}))
</a2ui>

<a2ui>
surface("live-weather")
root = Column([head, w], _, _, _, _, 3)
head = Heading("Lisbon this week", "Live weather")
w = WeatherReport("Lisbon")
</a2ui>
