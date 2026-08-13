/** @jsxImportSource @copilotkit/channels-ui */
import { describe, it, expect } from "vitest";
import {
  Message,
  Header,
  Section,
  Render,
  Carousel,
  CarouselCard,
  Image,
  Button,
  Actions,
  Table,
} from "@copilotkit/channels-ui";
import { renderToIR } from "@copilotkit/channels-ui";
import { validateRenderTree } from "./validate-render.js";

function check(ui: unknown): void {
  validateRenderTree(renderToIR(ui as never));
}

function ProductCardWithButton() {
  return (
    <div>
      <Button value="buy">Buy</Button>
    </div>
  );
}

describe("validateRenderTree", () => {
  it("accepts a carousel of Render and CarouselCard", () => {
    expect(() =>
      check(
        <Message>
          <Header>This week</Header>
          <Carousel>
            <CarouselCard>
              <Header>Shoes</Header>
              <Render alt="shoes">
                <div>card</div>
              </Render>
              <Button value="buy">Buy</Button>
            </CarouselCard>
            <Render alt="hat">
              <div>hat</div>
            </Render>
          </Carousel>
        </Message>,
      ),
    ).not.toThrow();
  });

  it("rejects Render without alt at runtime if someone bypasses types", () => {
    expect(() =>
      check({
        type: "render",
        props: { children: { type: "text", props: { value: "x" } } },
      }),
    ).toThrow("channels.render: <Render> requires alt");
  });

  it("rejects a Button inside Render", () => {
    expect(() =>
      check(
        <Render alt="x">
          <Button value="no">No</Button>
        </Render>,
      ),
    ).toThrow("cannot contain <Button>");
  });

  it("accepts a host button and div inside Render", () => {
    expect(() =>
      check(
        <Render alt="x">
          <div>
            <button>Buy</button>
          </div>
        </Render>,
      ),
    ).not.toThrow();
  });

  it("rejects empty Render children (null, false, or none)", () => {
    expect(() => check(<Render alt="x">{null}</Render>)).toThrow(
      "channels.render: <Render> requires children",
    );
    expect(() => check(<Render alt="x">{false}</Render>)).toThrow(
      "channels.render: <Render> requires children",
    );
    expect(() => check(<Render alt="x" />)).toThrow(
      "channels.render: <Render> requires children",
    );
  });

  it("rejects an unbranded card that wraps a Channels Button inside Render", () => {
    expect(() =>
      check(
        <Render alt="x">
          <ProductCardWithButton />
        </Render>,
      ),
    ).toThrow(
      "channels.render: <Render> cannot contain <Button>, <Select>, <Input>, or <Actions>",
    );
  });

  it("rejects CarouselCard outside Carousel", () => {
    expect(() =>
      check(
        <Message>
          <CarouselCard>
            <Render alt="x">
              <div />
            </Render>
          </CarouselCard>
        </Message>,
      ),
    ).toThrow("only valid inside <Carousel>");
  });

  it("rejects a Table inside CarouselCard", () => {
    expect(() =>
      check(
        <Carousel>
          <CarouselCard>
            <Table />
          </CarouselCard>
        </Carousel>,
      ),
    ).toThrow("only allows <Header>");
  });

  it("rejects 0 carousel slides", () => {
    expect(() => check(<Carousel />)).toThrow("1 to 10 slides");
  });

  it("rejects empty alt", () => {
    expect(() =>
      check(
        <Render alt="">
          <div />
        </Render>,
      ),
    ).toThrow("channels.render: <Render> requires alt");
  });

  it("rejects Actions inside Render", () => {
    expect(() =>
      check(
        <Render alt="x">
          <Actions>
            <Button value="no">No</Button>
          </Actions>
        </Render>,
      ),
    ).toThrow(
      "channels.render: <Render> cannot contain <Button>, <Select>, <Input>, or <Actions>",
    );
  });

  it("rejects nested Render", () => {
    expect(() =>
      check(
        <Render alt="outer">
          <Render alt="inner">
            <div />
          </Render>
        </Render>,
      ),
    ).toThrow(
      "channels.render: <Render> cannot contain <Render>, <Carousel>, or <CarouselCard>",
    );
  });

  it("rejects empty Render", () => {
    expect(() => check({ type: "render", props: { alt: "x" } })).toThrow(
      "channels.render: <Render> requires children",
    );
  });

  it("rejects two images on a card", () => {
    expect(() =>
      check(
        <Carousel>
          <CarouselCard>
            <Render alt="a">
              <div />
            </Render>
            <Image url="https://cdn.example/x.png" alt="b" />
          </CarouselCard>
        </Carousel>,
      ),
    ).toThrow("channels.render: <CarouselCard> allows at most one image");
  });

  it("rejects 4 buttons on a card", () => {
    expect(() =>
      check(
        <Carousel>
          <CarouselCard>
            <Button value="1">1</Button>
            <Button value="2">2</Button>
            <Button value="3">3</Button>
            <Button value="4">4</Button>
          </CarouselCard>
        </Carousel>,
      ),
    ).toThrow("channels.render: <CarouselCard> allows at most 3 <Button>s");
  });

  it("rejects two Headers on a card", () => {
    expect(() =>
      check(
        <Carousel>
          <CarouselCard>
            <Header>A</Header>
            <Header>B</Header>
          </CarouselCard>
        </Carousel>,
      ),
    ).toThrow("channels.render: <CarouselCard> allows at most one <Header>");
  });

  it("rejects two Sections on a card", () => {
    expect(() =>
      check(
        <Carousel>
          <CarouselCard>
            <Section>A</Section>
            <Section>B</Section>
          </CarouselCard>
        </Carousel>,
      ),
    ).toThrow("channels.render: <CarouselCard> allows at most one <Section>");
  });

  it("rejects 11 carousel slides", () => {
    const slides = Array.from({ length: 11 }, (_, i) => (
      <Render key={i} alt={`s${i}`}>
        <div />
      </Render>
    ));
    expect(() => check(<Carousel>{slides}</Carousel>)).toThrow(
      "channels.render: <Carousel> must have 1 to 10 slides",
    );
  });

  it("rejects illegal carousel child", () => {
    expect(() =>
      check(
        <Carousel>
          <Header>nope</Header>
        </Carousel>,
      ),
    ).toThrow(
      "channels.render: <Carousel> children must be <CarouselCard>, <Render>, or <Image>",
    );
  });
});
