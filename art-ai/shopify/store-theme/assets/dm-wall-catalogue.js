(function () {
  function initialize(root) {
    if (!root || root.dataset.dmReady) return;
    var rail = root.querySelector('.dm-catalogue__rail');
    if (!rail) return;
    root.dataset.dmReady = 'true';
    var rooms = Array.from(rail.children);
    var buttons = Array.from(root.querySelectorAll('[data-dm-direction]'));

    function targetPosition(room) {
      var center = room.offsetLeft - rail.offsetLeft - (rail.clientWidth - room.clientWidth) / 2;
      return Math.max(0, Math.min(rail.scrollWidth - rail.clientWidth, center));
    }

    function updateNavigation() {
      var first = rooms.length ? targetPosition(rooms[0]) : 0;
      var last = rooms.length ? targetPosition(rooms[rooms.length - 1]) : 0;
      buttons.forEach(function (button) {
        var unavailable = !rooms.length || (Number(button.dataset.dmDirection) < 0
          ? rail.scrollLeft <= first + 2
          : rail.scrollLeft >= last - 2);
        if (unavailable && document.activeElement === button) rail.focus({ preventScroll: true });
        button.disabled = unavailable;
      });
    }

    function move(direction) {
      if (!rooms.length) return;
      var center = rail.scrollLeft + rail.clientWidth / 2;
      var nearest = 0;
      var distance = Infinity;
      rooms.forEach(function (room, i) {
        var d = Math.abs(room.offsetLeft - rail.offsetLeft + room.clientWidth / 2 - center);
        if (d < distance) { distance = d; nearest = i; }
      });
      var target = rooms[Math.max(0, Math.min(rooms.length - 1, nearest + direction))];
      rail.scrollTo({
        left: targetPosition(target),
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
      });
    }

    buttons.forEach(function (button) {
      button.addEventListener('click', function () { move(Number(button.dataset.dmDirection)); });
    });
    rail.addEventListener('keydown', function (event) {
      if (event.target !== rail) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        move(event.key === 'ArrowRight' ? 1 : -1);
      }
    });
    rail.addEventListener('scroll', updateNavigation, { passive: true });
    new ResizeObserver(updateNavigation).observe(rail);
    updateNavigation();
  }
  document.querySelectorAll('.dm-catalogue').forEach(initialize);
  if (!window.dmCatalogueEditorListener) {
    window.dmCatalogueEditorListener = true;
    document.addEventListener('shopify:section:load', function (event) {
      event.target.querySelectorAll('.dm-catalogue').forEach(initialize);
    });
  }
})();