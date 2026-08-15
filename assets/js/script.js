// EcoPoint — interaction layer (scroll reveal, nav, counters, mock UI states)
document.addEventListener("DOMContentLoaded", () => {
  const navbar = document.querySelector(".navbar");
  const navToggle = document.querySelector(".nav-toggle");
  const navLinks = document.querySelector(".nav-links");

  window.addEventListener("scroll", () => {
    navbar.classList.toggle("scrolled", window.scrollY > 20);
  });

  if (navToggle) {
    navToggle.addEventListener("click", () => {
      navToggle.classList.toggle("open");
      navLinks.classList.toggle("open");
    });
    navLinks.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        navToggle.classList.remove("open");
        navLinks.classList.remove("open");
      });
    });
  }

  // Scroll reveal
  const revealEls = document.querySelectorAll(".reveal");
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
  );
  revealEls.forEach((el) => io.observe(el));

  // Animated counters
  const counters = document.querySelectorAll("[data-counter]");
  const counterIO = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = parseFloat(el.dataset.counter);
        const suffix = el.dataset.suffix || "";
        const decimals = el.dataset.decimals ? parseInt(el.dataset.decimals) : 0;
        const duration = 1400;
        const start = performance.now();
        const animate = (now) => {
          const progress = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          const value = target * eased;
          el.textContent = value.toFixed(decimals) + suffix;
          if (progress < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
        counterIO.unobserve(el);
      });
    },
    { threshold: 0.4 }
  );
  counters.forEach((el) => counterIO.observe(el));

  // Station demo screen — cycles through waste types to illustrate the interactive display
  const demoTypes = [
    { icon: "🥤", label: "Plastik", coin: "+10", sound: "Plastik səsi 🔊" },
    { icon: "📄", label: "Kağız", coin: "+6", sound: "Kağız səsi 🔊" },
    { icon: "🍾", label: "Şüşə", coin: "+8", sound: "Şüşə səsi 🔊" },
    { icon: "🔩", label: "Metal", coin: "+12", sound: "Metal səsi 🔊" },
  ];
  const demoScreen = document.querySelector("[data-station-demo]");
  if (demoScreen) {
    let i = 0;
    const render = () => {
      const t = demoTypes[i];
      demoScreen.innerHTML = `
        <div class="demo-icon">${t.icon}</div>
        <div class="demo-label">${t.label} aşkarlandı</div>
        <div class="demo-coin">${t.coin} EcoCoin</div>
        <div class="demo-sound">${t.sound}</div>
        <div class="demo-msg">Təşəkkürlər! ${t.coin} EcoCoin qazandınız!</div>
      `;
      i = (i + 1) % demoTypes.length;
    };
    render();
    setInterval(render, 2600);
  }

  // Tosbik reaction cycling in gamification/ecocoin mock strips
  document.querySelectorAll("[data-tosbik-cycle]").forEach((wrap) => {
    const bubbles = wrap.querySelectorAll(".tosbik-quote");
    if (bubbles.length < 2) return;
    let idx = 0;
    setInterval(() => {
      bubbles[idx].style.display = "none";
      idx = (idx + 1) % bubbles.length;
      bubbles[idx].style.display = "flex";
    }, 3200);
  });
});
