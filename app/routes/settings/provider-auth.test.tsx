import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { OperationSnapshot, ProviderStatusDto } from "~/provider-auth-manager";

import { AuthDialogView, describeSource, isSafeHttpUrl, ProviderList } from "./provider-auth";

function providersFixture(): ProviderStatusDto[] {
  return [
    {
      registration: "registered",
      id: "anthropic",
      name: "Anthropic",
      methods: [{ type: "api_key", label: "Anthropic API key" }],
      storedCredential: { type: "api_key" },
      effectiveAuth: { type: "api_key", source: { kind: "stored" } },
    },
    {
      registration: "registered",
      id: "openai",
      name: "OpenAI",
      methods: [
        { type: "api_key", label: "OpenAI API key" },
        { type: "oauth", label: "Sign in with OpenAI" },
      ],
      storedCredential: null,
      effectiveAuth: {
        type: "api_key",
        source: { kind: "environment", label: "OPENAI_API_KEY" },
      },
    },
    {
      registration: "orphaned",
      id: "ghost",
      name: "ghost",
      methods: [],
      storedCredential: { type: "oauth" },
      effectiveAuth: null,
    },
  ];
}

function renderList(overrides: Partial<Parameters<typeof ProviderList>[0]> = {}) {
  return render(
    <ProviderList
      providers={overrides.providers ?? providersFixture()}
      onStartLogin={overrides.onStartLogin ?? (() => {})}
      onStartRemoval={overrides.onStartRemoval ?? (() => {})}
      startPending={overrides.startPending ?? null}
      operationActive={overrides.operationActive ?? false}
      conflictOperationId={overrides.conflictOperationId ?? null}
    />,
  );
}

describe("Provider authentication settings", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows runtime status, auth methods, and removal", async () => {
    const screen = await renderList();
    await expect.element(screen.getByText("Anthropic", { exact: true })).toBeInTheDocument();
    await expect.element(screen.getByText("anthropic", { exact: true })).toBeInTheDocument();
    await expect.element(screen.getByText("Not configured", { exact: true })).toBeInTheDocument();
    await expect
      .element(screen.getByText("Stored credential", { exact: true }))
      .toBeInTheDocument();
    await expect.element(screen.getByText("Stored: API key", { exact: true })).toBeInTheDocument();
    await expect.element(screen.getByText("Stored: OAuth", { exact: true })).toBeInTheDocument();
  });

  it("starts login directly for single-method providers", async () => {
    const onStartLogin = vi.fn();
    const screen = await renderList({
      onStartLogin,
      providers: [providersFixture()[0]],
    });
    await screen.getByRole("button", { name: "Login", exact: true }).click();
    expect(onStartLogin).toHaveBeenCalledWith("anthropic", "api_key");
  });

  it("shows a method chooser for multi-method providers", async () => {
    const onStartLogin = vi.fn();
    const openai = providersFixture()[1];
    const screen = await renderList({ onStartLogin, providers: [openai] });
    await screen.getByRole("button", { name: "Login", exact: true }).click();
    expect(onStartLogin).not.toHaveBeenCalled();
    await expect.element(screen.getByRole("radiogroup")).toBeInTheDocument();
    await expect.element(screen.getByRole("radio", { name: /OpenAI API key/ })).toBeInTheDocument();
    await expect
      .element(screen.getByRole("radio", { name: /Sign in with OpenAI/ }))
      .toBeInTheDocument();
    await screen.getByRole("radio", { name: /Sign in with OpenAI/ }).click();
    await screen.getByRole("button", { name: "Submit" }).click();
    expect(onStartLogin).toHaveBeenCalledWith("openai", "oauth");
  });

  it("keeps the chooser open until the login prompt appears", async () => {
    const onStartLogin = vi.fn();
    const openai = providersFixture()[1];
    const screen = await renderList({ onStartLogin, providers: [openai] });
    await screen.getByRole("button", { name: "Login", exact: true }).click();
    await expect.element(screen.getByRole("radiogroup")).toBeInTheDocument();
    await screen.getByRole("button", { name: "Submit" }).click();
    expect(onStartLogin).toHaveBeenCalledWith("openai", "api_key");
    await expect.element(screen.getByRole("radiogroup")).toBeInTheDocument();
  });

  it("dismisses the method chooser without starting login", async () => {
    const onStartLogin = vi.fn();
    const openai = providersFixture()[1];
    const screen = await renderList({ onStartLogin, providers: [openai] });
    await screen.getByRole("button", { name: "Login", exact: true }).click();
    await expect.element(screen.getByRole("radiogroup")).toBeInTheDocument();
    await screen.getByRole("button", { name: "Cancel" }).click();
    expect(onStartLogin).not.toHaveBeenCalled();
    expect(screen.getByRole("radiogroup").query()).not.toBeInTheDocument();
  });

  it("keeps row buttons unchanged while starting from the chooser", async () => {
    const openai = providersFixture()[1];
    const base = {
      providers: [openai],
      onStartLogin: () => {},
      onStartRemoval: () => {},
      conflictOperationId: null as string | null,
    };
    const screen = await render(
      <ProviderList {...base} startPending={null} operationActive={false} />,
    );
    await screen.getByRole("button", { name: "Login", exact: true }).click();
    await expect.element(screen.getByRole("radiogroup")).toBeInTheDocument();
    await screen.rerender(
      <ProviderList {...base} startPending="pending" operationActive={false} />,
    );
    const rowButton = [...screen.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Login",
    );
    expect(rowButton?.disabled).toBe(false);
  });

  it("requires confirmation before removing stored auth", async () => {
    const onStartRemoval = vi.fn();
    const screen = await renderList({
      onStartRemoval,
      providers: [providersFixture()[0]],
    });
    await screen.getByRole("button", { name: "Remove" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Confirm remove" }))
      .toBeInTheDocument();
    expect(onStartRemoval).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "Confirm remove" }).click();
    expect(onStartRemoval).toHaveBeenCalledWith("anthropic");
  });

  it("displays remaining external auth after stored removal", async () => {
    const screen = await renderList({
      providers: [
        {
          registration: "registered",
          id: "openai",
          name: "OpenAI",
          methods: [{ type: "api_key", label: "OpenAI API key" }],
          storedCredential: null,
          effectiveAuth: {
            type: "api_key",
            source: { kind: "environment", label: "OPENAI_API_KEY" },
          },
        },
      ],
    });
    await expect.element(screen.getByText("OPENAI_API_KEY", { exact: true })).toBeInTheDocument();
    await expect
      .element(screen.getByText("No stored credential", { exact: true }))
      .toBeInTheDocument();
  });

  it("renders select prompts as radio options", async () => {
    const snapshot: Extract<OperationSnapshot, { kind: "login"; phase: "running" }> = {
      operationId: "op-1",
      kind: "login",
      providerId: "bedrock",
      providerName: "Bedrock",
      authType: "api_key",
      phase: "running",
      prompt: {
        id: 1,
        type: "select",
        message: "Choose a region",
        options: [
          { id: "us-east-1", label: "US East" },
          { id: "ap-northeast-1", label: "Tokyo", description: "Asia Pacific" },
        ],
      },
      events: [],
    };
    const screen = await render(
      <AuthDialogView
        snapshot={snapshot}
        answerPending={false}
        cancelPending={false}
        onAnswer={() => {}}
        onCancel={() => {}}
        onDismiss={() => {}}
      />,
    );
    await expect.element(screen.getByRole("radiogroup")).toBeInTheDocument();
    await expect.element(screen.getByRole("radio", { name: /US East/ })).toBeInTheDocument();
    await expect.element(screen.getByRole("radio", { name: /Tokyo/ })).toBeInTheDocument();
  });

  it("hides stale provider links once the operation ends", async () => {
    const snapshot: Extract<OperationSnapshot, { kind: "login"; phase: "terminal" }> = {
      operationId: "op-1",
      kind: "login",
      providerId: "anthropic",
      providerName: "Anthropic",
      authType: "oauth",
      phase: "terminal",
      outcome: "cancelled",
      message: "Login was cancelled.",
      events: [{ type: "auth_url", url: "https://example.com/auth", instructions: "Open this" }],
    };
    const screen = await render(
      <AuthDialogView
        snapshot={snapshot}
        answerPending={false}
        cancelPending={false}
        onAnswer={() => {}}
        onCancel={() => {}}
        onDismiss={() => {}}
      />,
    );
    await expect.element(screen.getByText(/Sign-in was cancelled/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open authorization link" }).query(),
    ).not.toBeInTheDocument();
  });

  it("renders authorization links, device codes, progress, and terminal states", async () => {
    const snapshot: Extract<OperationSnapshot, { kind: "login"; phase: "running" }> = {
      operationId: "op-1",
      kind: "login",
      providerId: "p",
      providerName: "P",
      authType: "oauth",
      phase: "running",
      prompt: null,
      events: [
        { type: "auth_url", url: "https://example.com/auth", instructions: "Open this" },
        {
          type: "device_code",
          userCode: "ABCD-1234",
          verificationUri: "https://example.com/device",
        },
        { type: "progress", message: "Waiting…" },
        { type: "info", message: "Hello", links: [{ url: "https://example.com/docs" }] },
      ],
    };
    const screen = await render(
      <AuthDialogView
        snapshot={snapshot}
        answerPending={false}
        cancelPending={false}
        onAnswer={() => {}}
        onCancel={() => {}}
        onDismiss={() => {}}
      />,
    );
    const authLink = screen.getByRole("link", { name: "Open authorization link" });
    await expect.element(authLink).toHaveAttribute("href", "https://example.com/auth");
    await expect.element(authLink).toHaveAttribute("target", "_blank");
    await expect.element(authLink).toHaveAttribute("rel", "noreferrer noopener");
    await expect.element(screen.getByText("ABCD-1234", { exact: true })).toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: "Open verification link" }))
      .toBeInTheDocument();
    await expect.element(screen.getByText("Waiting…", { exact: true })).toBeInTheDocument();
  });

  it("disables cancel while a cancel is pending", async () => {
    const snapshot: Extract<OperationSnapshot, { kind: "login"; phase: "running" }> = {
      operationId: "op-1",
      kind: "login",
      providerId: "p",
      providerName: "P",
      authType: "api_key",
      phase: "running",
      prompt: null,
      events: [],
    };
    const screen = await render(
      <AuthDialogView
        snapshot={snapshot}
        answerPending={false}
        cancelPending={true}
        onAnswer={() => {}}
        onCancel={() => {}}
        onDismiss={() => {}}
      />,
    );
    await expect.element(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("offers no cancellation after removal starts", async () => {
    const running: Extract<OperationSnapshot, { kind: "removal"; phase: "running" }> = {
      operationId: "op-r",
      kind: "removal",
      providerId: "p",
      providerName: "P",
      phase: "running",
    };
    const screen = await render(
      <AuthDialogView
        snapshot={running}
        answerPending={false}
        cancelPending={false}
        onAnswer={() => {}}
        onCancel={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel" }).query()).not.toBeInTheDocument();
    await screen.unmount();
    const done: Extract<OperationSnapshot, { kind: "removal"; phase: "terminal" }> = {
      ...running,
      phase: "terminal",
      outcome: "success",
      message: null,
    };
    const doneScreen = await render(
      <AuthDialogView
        snapshot={done}
        answerPending={false}
        cancelPending={false}
        onAnswer={() => {}}
        onCancel={() => {}}
        onDismiss={() => {}}
      />,
    );
    await expect
      .element(doneScreen.getByText("Stored credential removed.", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(doneScreen.getByText(/another source such as an environment variable/))
      .toBeInTheDocument();
  });

  it("renders login warning and failure without secrets", async () => {
    const warning: Extract<OperationSnapshot, { kind: "login"; phase: "terminal" }> = {
      operationId: "op-1",
      kind: "login",
      providerId: "p",
      providerName: "P",
      authType: "api_key",
      phase: "terminal",
      outcome: "warning",
      message: "Catalog refresh did not complete.",
      events: [],
    };
    const screen = await render(
      <AuthDialogView
        snapshot={warning}
        answerPending={false}
        cancelPending={false}
        onAnswer={() => {}}
        onCancel={() => {}}
        onDismiss={() => {}}
      />,
    );
    await expect.element(screen.getByText(/Signed in with a warning/)).toBeInTheDocument();
    await screen.unmount();
    const failure: Extract<OperationSnapshot, { kind: "login"; phase: "terminal" }> = {
      ...warning,
      outcome: "failure",
      message: "Bad credentials.",
    };
    const failureScreen = await render(
      <AuthDialogView
        snapshot={failure}
        answerPending={false}
        cancelPending={false}
        onAnswer={() => {}}
        onCancel={() => {}}
        onDismiss={() => {}}
      />,
    );
    await expect.element(failureScreen.getByRole("alert")).toHaveTextContent("Bad credentials.");
  });
});

describe("provider auth helpers", () => {
  it("allows only http(s) provider links", () => {
    expect(isSafeHttpUrl("https://example.com/auth")).toBe(true);
    expect(isSafeHttpUrl("http://localhost:3000/callback")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/plain,hi")).toBe(false);
    expect(isSafeHttpUrl("not a url")).toBe(false);
  });

  it("describes effective sources without secrets", () => {
    expect(
      describeSource({
        registration: "registered",
        id: "a",
        name: "A",
        methods: [],
        storedCredential: null,
        effectiveAuth: { type: "api_key", source: { kind: "environment", label: "A_KEY" } },
      }),
    ).toBe("A_KEY");
    expect(
      describeSource({
        registration: "orphaned",
        id: "a",
        name: "a",
        methods: [],
        storedCredential: { type: "api_key" },
        effectiveAuth: null,
      }),
    ).toBeNull();
  });
});
