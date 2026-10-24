from research_desk.images import parse_images


def page(
    index, title, mime="image/jpeg", thumb="https://upload.wikimedia.org/a.jpg?utm=1"
):
    return {
        "index": index,
        "title": f"File:{title}",
        "imageinfo": [
            {
                "mime": mime,
                "thumburl": thumb,
                "descriptionurl": f"https://commons.wikimedia.org/wiki/File:{title}",
                "thumbwidth": 960,
                "thumbheight": 640,
                "extmetadata": {
                    "Artist": {"value": '<a href="//x">Jane <b>Doe</b></a>'},
                    "LicenseShortName": {"value": "CC BY-SA 4.0"},
                    "ImageDescription": {"value": "<p>A &amp; B</p>"},
                },
            }
        ],
    }


def test_parse_images_keeps_search_order_pictures_and_credit():
    payload = {
        "query": {
            "pages": {
                "2": page(2, "Second.png", mime="image/png"),
                "1": page(1, "First.jpg"),
                "3": page(3, "Diagram.svg", mime="image/svg+xml"),
            }
        }
    }
    images = parse_images(payload, count=4)
    assert [image["title"] for image in images] == ["First", "Second"]
    first = images[0]
    assert first["url"] == "https://upload.wikimedia.org/a.jpg"
    assert first["credit"] == "Jane Doe · CC BY-SA 4.0 · Wikimedia Commons"
    assert first["description"] == "A & B"


def test_parse_images_respects_count_and_empty_payloads():
    payload = {"query": {"pages": {str(i): page(i, f"P{i}.jpg") for i in range(5)}}}
    assert len(parse_images(payload, count=2)) == 2
    assert parse_images({}, count=3) == []
