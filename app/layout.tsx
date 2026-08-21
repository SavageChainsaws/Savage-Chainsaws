<body className="min-h-full flex flex-col">
  {/* Subtle background images */}
  <img
  src="/images/sparks.jpg"
  alt=""
  style={{
    position: "fixed",
    left: "0",
    bottom: "0",
    width: "55%",
    opacity: 0.35,
    zIndex: 0,
    pointerEvents: "none",
    objectFit: "cover",
  }}
/>
<img
  src="/images/stihl-ms500i.jpg"
  alt=""
  style={{
    position: "fixed",
    right: "0",
    top: "0",
    width: "50%",
    opacity: 0.30,
    zIndex: 0,
    pointerEvents: "none",
    objectFit: "cover",
  }}
/>
  {children}
</body>