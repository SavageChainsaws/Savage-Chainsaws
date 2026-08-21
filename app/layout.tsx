<body className="min-h-full flex flex-col">
  {/* Subtle background images */}
  <img
    src="/images/sparks.jpg"
    alt=""
    style={{
      position: "fixed",
      left: "-40px",
      bottom: "-30px",
      width: "48%",
      opacity: 0.18,
      zIndex: -1,
      pointerEvents: "none",
      objectFit: "cover",
    }}
  />
  <img
    src="/images/stihl-ms500i.jpg"
    alt=""
    style={{
      position: "fixed",
      right: "-50px",
      top: "-20px",
      width: "42%",
      opacity: 0.16,
      zIndex: -1,
      pointerEvents: "none",
      objectFit: "cover",
    }}
  />
  {children}
</body>