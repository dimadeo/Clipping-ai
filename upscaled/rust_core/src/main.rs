use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use image::imageops::FilterType;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

#[derive(Debug, Parser)]
#[command(about = "Local image inspection and resizing for the Upscaled workflow")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Inspect {
        source: PathBuf,
    },
    Plan {
        #[arg(long)]
        long_edge: u32,
        #[arg(long)]
        target: u32,
        #[arg(long, default_value_t = 4.0)]
        max_scale: f64,
        #[arg(long, default_value_t = 4)]
        max_passes: usize,
    },
    Resize {
        source: PathBuf,
        output: PathBuf,
        #[arg(long)]
        scale: f64,
    },
}

fn sha256_file(path: &Path) -> Result<String> {
    let file = File::open(path).with_context(|| format!("could not open {}", path.display()))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];

    loop {
        let bytes_read = reader.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn plan_passes(long_edge: u32, target: u32, max_scale: f64, max_passes: usize) -> Result<Vec<f64>> {
    if long_edge == 0 || target == 0 || max_scale <= 1.0 || max_passes == 0 {
        bail!("dimensions must be positive, max-scale must exceed 1, and max-passes must be positive");
    }
    if target <= long_edge {
        return Ok(Vec::new());
    }

    let mut scales = Vec::new();
    let mut remaining = target as f64 / long_edge as f64;
    while remaining > 1.000_001 && scales.len() < max_passes {
        let scale = remaining.min(max_scale);
        scales.push(scale);
        remaining /= scale;
    }

    if remaining > 1.000_001 {
        bail!("target requires more than {max_passes} passes at a maximum scale of {max_scale}");
    }
    Ok(scales)
}

fn resize(source: &Path, output: &Path, scale: f64) -> Result<()> {
    if scale <= 1.0 {
        bail!("scale must exceed 1");
    }

    let image = image::open(source).with_context(|| format!("could not decode {}", source.display()))?;
    let width = (image.width() as f64 * scale).round().clamp(1.0, u32::MAX as f64) as u32;
    let height = (image.height() as f64 * scale).round().clamp(1.0, u32::MAX as f64) as u32;
    let resized = image.resize_exact(width, height, FilterType::Lanczos3);

    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)?;
    }
    resized.save(output).with_context(|| format!("could not write {}", output.display()))?;
    Ok(())
}

fn run(cli: Cli) -> Result<()> {
    match cli.command {
        Command::Inspect { source } => {
            let image = image::open(&source).with_context(|| format!("could not decode {}", source.display()))?;
            println!(
                "path={} width={} height={} sha256={}",
                source.display(),
                image.width(),
                image.height(),
                sha256_file(&source)?
            );
        }
        Command::Plan { long_edge, target, max_scale, max_passes } => {
            let passes = plan_passes(long_edge, target, max_scale, max_passes)?;
            println!("passes={}", passes.iter().map(|scale| format!("{scale:.4}")).collect::<Vec<_>>().join(","));
        }
        Command::Resize { source, output, scale } => resize(&source, &output, scale)?,
    }
    Ok(())
}

fn main() -> Result<()> {
    run(Cli::parse())
}

#[cfg(test)]
mod tests {
    use super::plan_passes;

    #[test]
    fn plans_a_single_pass_when_possible() {
        assert_eq!(plan_passes(1000, 4000, 4.0, 4).unwrap(), vec![4.0]);
    }

    #[test]
    fn splits_large_scale_across_passes() {
        assert_eq!(plan_passes(1000, 8000, 4.0, 4).unwrap(), vec![4.0, 2.0]);
    }

    #[test]
    fn rejects_an_unreachable_target() {
        assert!(plan_passes(1000, 100_000, 4.0, 2).is_err());
    }
}