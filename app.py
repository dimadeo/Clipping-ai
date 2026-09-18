import tkinter as tk
from pathlib import Path

from clipping import CampaignConfig, MasterClippingPipeline


def run_pipeline():
    url = url_entry.get().strip()
    campaign = campaign_entry.get().strip() or "EmmaChamberlain"
    outdir = Path(outdir_entry.get().strip() or "./output_clips")

    config = CampaignConfig(campaign_name=campaign, output_dir=outdir)
    pipeline = MasterClippingPipeline(config)
    pipeline.run(url or "https://www.youtube.com/watch?v=WAmklfhUjns")
    status_var.set("Pipeline complete. Check output_clips/")


def main():
    global url_entry, campaign_entry, outdir_entry, status_var

    root = tk.Tk()
    root.title("Clipping AI Business")
    root.geometry("430x260")

    frame = tk.Frame(root, padx=18, pady=18)
    frame.pack(fill="both", expand=True)

    lbl1 = tk.Label(frame, text="YouTube URL")
    lbl1.grid(row=0, column=0, sticky="w", pady=(0, 6))
    url_entry = tk.Entry(frame, width=45)
    url_entry.grid(row=1, column=0, sticky="ew")
    url_entry.insert(0, "https://www.youtube.com/watch?v=WAmklfhUjns")

    lbl2 = tk.Label(frame, text="Campaign")
    lbl2.grid(row=2, column=0, sticky="w", pady=(10, 6))
    campaign_entry = tk.Entry(frame, width=45)
    campaign_entry.grid(row=3, column=0, sticky="ew")
    campaign_entry.insert(0, "EmmaChamberlain")

    lbl3 = tk.Label(frame, text="Output folder")
    lbl3.grid(row=4, column=0, sticky="w", pady=(10, 6))
    outdir_entry = tk.Entry(frame, width=45)
    outdir_entry.grid(row=5, column=0, sticky="ew")
    outdir_entry.insert(0, "./output_clips")

    run_btn = tk.Button(frame, text="Run Pipeline", command=run_pipeline)
    run_btn.grid(row=6, column=0, pady=(16, 8), sticky="ew")

    status_var = tk.StringVar(value="Ready")
    status_label = tk.Label(frame, textvariable=status_var, fg="darkgreen")
    status_label.grid(row=7, column=0, sticky="w")

    root.mainloop()


if __name__ == "__main__":
    main()
