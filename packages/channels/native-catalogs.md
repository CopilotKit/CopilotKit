# Native Channel JSX catalog

This file is generated from the reviewed Slack and Teams manifests. Run
`pnpm generate:channel-native-catalogs` after a manifest change.

## Slack

Source: https://docs.slack.dev/reference/block-kit/

<!-- prettier-ignore -->
| JSX component | Provider type |
| --- | --- |
| Actions | `actions` |
| Card | `card` |
| Carousel | `carousel` |
| Container | `container` |
| Context | `context` |
| ContextActions | `context_actions` |
| DataTable | `data_table` |
| DataVisualization | `data_visualization` |
| Divider | `divider` |
| File | `file` |
| Header | `header` |
| Image | `image` |
| Input | `input` |
| Markdown | `markdown` |
| Plan | `plan` |
| RichText | `rich_text` |
| Section | `section` |
| Table | `table` |
| TaskCard | `task_card` |
| Video | `video` |
| Button | `button` |
| Checkboxes | `checkboxes` |
| ChannelsSelect | `channels_select` |
| ConversationsSelect | `conversations_select` |
| DatePicker | `datepicker` |
| DateTimePicker | `datetimepicker` |
| EmailInput | `email_text_input` |
| ExternalSelect | `external_select` |
| FeedbackButtons | `feedback_buttons` |
| IconButton | `icon_button` |
| Image | `image` |
| MultiChannelsSelect | `multi_channels_select` |
| MultiConversationsSelect | `multi_conversations_select` |
| MultiExternalSelect | `multi_external_select` |
| MultiStaticSelect | `multi_static_select` |
| MultiUsersSelect | `multi_users_select` |
| NumberInput | `number_input` |
| Overflow | `overflow` |
| PlainTextInput | `plain_text_input` |
| RadioButtons | `radio_buttons` |
| RichTextInput | `rich_text_input` |
| StaticSelect | `static_select` |
| TimePicker | `timepicker` |
| UrlInput | `url_text_input` |
| UsersSelect | `users_select` |
| WorkflowButton | `workflow_button` |
| ConfirmationDialog | `confirm` |
| ConversationFilter | `conversation_filter` |
| DispatchActionConfig | `dispatch_action_config` |
| MarkdownText | `mrkdwn` |
| Option | `option` |
| OptionGroup | `option_group` |
| PlainText | `plain_text` |
| RichTextList | `rich_text_list` |
| RichTextPreformatted | `rich_text_preformatted` |
| RichTextQuote | `rich_text_quote` |
| RichTextSection | `rich_text_section` |
| RichTextText | `text` |
| SlackFile | `slack_file` |
| Trigger | `trigger` |
| Workflow | `workflow` |

## Teams

Source: https://adaptivecards.microsoft.com/

<!-- prettier-ignore -->
| JSX component | Provider type | Fixed identity | Status |
| --- | --- | --- | --- |
| ActionSet | `ActionSet` | — | stable body |
| Badge | `Badge` | — | stable body |
| Carousel | `Carousel` | — | stable body |
| CodeBlock | `CodeBlock` | — | stable body |
| ColumnSet | `ColumnSet` | — | stable body |
| CompoundButton | `CompoundButton` | — | stable body |
| Container | `Container` | — | stable body |
| FactSet | `FactSet` | — | stable body |
| Icon | `Icon` | — | stable body |
| Image | `Image` | — | stable body |
| ImageSet | `ImageSet` | — | stable body |
| Media | `Media` | — | stable body |
| ProgressBar | `ProgressBar` | — | stable body |
| ProgressRing | `ProgressRing` | — | stable body |
| Rating | `Rating` | — | stable body |
| RichTextBlock | `RichTextBlock` | — | stable body |
| Table | `Table` | — | stable body |
| TextBlock | `TextBlock` | — | stable body |
| ChoiceSet | `Input.ChoiceSet` | — | stable body |
| Date | `Input.Date` | — | stable body |
| Number | `Input.Number` | — | stable body |
| Rating | `Input.Rating` | — | stable body |
| Text | `Input.Text` | — | stable body |
| Time | `Input.Time` | — | stable body |
| Toggle | `Input.Toggle` | — | stable body |
| Donut | `Chart.Donut` | — | stable body |
| Pie | `Chart.Pie` | — | stable body |
| Line | `Chart.Line` | — | stable body |
| HorizontalBar | `Chart.HorizontalBar` | — | stable body |
| HorizontalBarStacked | `Chart.HorizontalBar.Stacked` | — | stable body |
| VerticalBar | `Chart.VerticalBar` | — | stable body |
| VerticalBarGrouped | `Chart.VerticalBar.Grouped` | — | stable body |
| Gauge | `Chart.Gauge` | — | stable body |
| Persona | `Component` | `graph.microsoft.com/user` | stable body |
| PersonaSet | `Component` | `graph.microsoft.com/users` | stable body |
| File | `Component` | `graph.microsoft.com/file` | stable body |
| GraphResource | `Component` | `graph.microsoft.com/resource` | stable body |
| CalendarEvent | `Component` | `graph.microsoft.com/event` | stable body |
| Execute | `Action.Execute` | — | stable action |
| OpenUrl | `Action.OpenUrl` | — | stable action |
| Popover | `Action.Popover` | — | stable action |
| ResetInputs | `Action.ResetInputs` | — | stable action |
| ShowCard | `Action.ShowCard` | — | stable action |
| Submit | `Action.Submit` | — | stable action |
| ToggleVisibility | `Action.ToggleVisibility` | — | stable action |
| Column | `Column` | — | supporting node |
| TableRow | `TableRow` | — | supporting node |
| TableCell | `TableCell` | — | supporting node |
| TextRun | `TextRun` | — | supporting node |
| Fact | `Fact` | — | supporting node |
| Choice | `Input.Choice` | — | supporting node |
| MediaSource | `MediaSource` | — | supporting node |
| CaptionSource | `CaptionSource` | — | supporting node |
| TargetElement | `TargetElement` | — | supporting node |
| CarouselPage | `CarouselPage` | — | supporting node |
| DataPoint | `DataPoint` | — | supporting node |
| ChartData | `ChartData` | — | supporting node |
| FlowLayout | `Layout.Flow` | — | supporting node |
| AreaGridLayout | `Layout.AreaGrid` | — | supporting node |
| Accordion | `Accordion` | — | preview |
| LoopComponent | `LoopComponent` | — | preview |
| TabSet | `TabSet` | — | preview |
| RunCommands | `Action.RunCommands` | — | preview |
