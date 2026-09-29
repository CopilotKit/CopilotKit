<script setup lang="ts">
const tasks = [
  { title: "Q3 launch plan", meta: "Updated 2h ago", status: "In review" },
  { title: "Onboarding revamp", meta: "Updated yesterday", status: "Draft" },
  { title: "Pricing page copy", meta: "Updated 3d ago", status: "Shipped" },
  { title: "Customer interviews", meta: "Updated last week", status: "Draft" },
];
</script>

<!--
  A plain host application used behind sidebars, popups and toggle buttons,
  so layout components can be judged in context.
-->
<template>
  <div class="host-page">
    <header class="host-page__header">
      <div class="host-page__logo" />
      <span class="host-page__brand">Acme Workspace</span>
      <nav class="host-page__nav">
        <span class="host-page__nav-active">Projects</span>
        <span>Docs</span>
        <span>Team</span>
      </nav>
    </header>
    <main class="host-page__main">
      <h1 class="host-page__title">Projects</h1>
      <p class="host-page__lede">
        Draft updates, summarize discussions and track action items with the
        assistant while you stay in context.
      </p>
      <div class="host-page__grid">
        <article v-for="task in tasks" :key="task.title" class="host-card">
          <div class="host-card__head">
            <h2 class="host-card__title">{{ task.title }}</h2>
            <span class="host-badge">{{ task.status }}</span>
          </div>
          <p class="host-card__meta">{{ task.meta }}</p>
        </article>
      </div>
    </main>
    <slot />
  </div>
</template>
