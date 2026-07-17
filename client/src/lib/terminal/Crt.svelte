<!-- CRT-эффект: сканлайны + виньетка. Умеренный и отключаемый (ТЗ п. 4.1). -->
<div class="crt-overlay" aria-hidden="true"></div>

<style>
  .crt-overlay {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 100;
    background:
      repeating-linear-gradient(
        0deg,
        rgba(0, 0, 0, 0.15) 0px,
        rgba(0, 0, 0, 0.15) 1px,
        transparent 1px,
        transparent 3px
      ),
      radial-gradient(ellipse at center, transparent 60%, rgba(0, 0, 0, 0.35) 100%);
  }
</style>
