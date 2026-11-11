// Encoding helpers: hex, ISO-8601 time, NEAR Intents nonces, ERC-191 and Hyperliquid EIP-712 digests.
use near_sdk::{base64, env};

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn unhex(s: &str) -> Vec<u8> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    assert!(s.len() % 2 == 0, "odd hex length");
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("bad hex")).collect()
}

// Howard Hinnant's civil-from-days / days-from-civil (proleptic Gregorian, UTC).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// `ms` since epoch -> "2026-11-11T05:12:04.370Z".
pub fn iso_from_ms(ms: u64) -> String {
    let (days, rem) = ((ms / 86_400_000) as i64, ms % 86_400_000);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000
    )
}

/// Parses "YYYY-MM-DDTHH:MM:SS[.fff]Z" (the format 1Click uses) to ms since epoch.
pub fn ms_from_iso(s: &str) -> Option<u64> {
    let s = s.strip_suffix('Z')?;
    let (date, time) = s.split_once('T')?;
    let mut dp = date.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, d) = (dp.next()??, dp.next()??, dp.next()??);
    let (hms, frac) = time.split_once('.').unwrap_or((time, "0"));
    let mut tp = hms.split(':').map(|p| p.parse::<u64>().ok());
    let (hh, mm, ss) = (tp.next()??, tp.next()??, tp.next()??);
    let ms: u64 = format!("{frac:0<3}")[..3].parse().ok()?;
    let days = days_from_civil(y, m, d);
    Some(days as u64 * 86_400_000 + hh * 3_600_000 + mm * 60_000 + ss * 1000 + ms)
}

/// intents.near versioned nonce: MAGIC(5628f6c6) || 0x00 || salt(4) || deadline ns i64 LE(8) || random(15).
pub fn versioned_nonce(salt: [u8; 4], deadline_ns: u64, random: &[u8]) -> String {
    use base64::Engine;
    let mut n = [0u8; 32];
    n[..4].copy_from_slice(&[0x56, 0x28, 0xf6, 0xc6]);
    n[5..9].copy_from_slice(&salt);
    n[9..17].copy_from_slice(&(deadline_ns as i64).to_le_bytes());
    n[17..].copy_from_slice(&random[..15]);
    base64::engine::general_purpose::STANDARD.encode(n)
}

pub fn erc191_digest(payload: &str) -> [u8; 32] {
    let mut msg = format!("\x19Ethereum Signed Message:\n{}", payload.len()).into_bytes();
    msg.extend_from_slice(payload.as_bytes());
    env::keccak256_array(&msg)
}

/// Fixed-point amount -> decimal string without trailing zeros ("19.5", "20").
pub fn fmt_decimal(amount: u128, decimals: u32) -> String {
    let scale = 10u128.pow(decimals);
    let frac = format!("{:0width$}", amount % scale, width = decimals as usize);
    let frac = frac.trim_end_matches('0');
    if frac.is_empty() { (amount / scale).to_string() } else { format!("{}.{frac}", amount / scale) }
}

/// EIP-712 digests for Hyperliquid user-signed actions (domain "HyperliquidSignTransaction").
pub mod eip712 {
    use super::unhex;
    use near_sdk::env::keccak256_array as k;

    pub enum Field<'a> {
        Str(&'a str),
        Addr(&'a str),
        U64(u64),
    }

    fn word_u64(v: u64) -> [u8; 32] {
        let mut w = [0u8; 32];
        w[24..].copy_from_slice(&v.to_be_bytes());
        w
    }

    fn encode(f: &Field) -> [u8; 32] {
        match f {
            Field::Str(s) => k(s.as_bytes()),
            Field::Addr(a) => {
                let mut w = [0u8; 32];
                w[12..].copy_from_slice(&unhex(a));
                w
            }
            Field::U64(v) => word_u64(*v),
        }
    }

    /// `type_sig` is the full type string, e.g.
    /// "HyperliquidTransaction:ApproveAgent(string hyperliquidChain,address agentAddress,string agentName,uint64 nonce)".
    pub fn digest(chain_id: u64, type_sig: &str, fields: &[Field]) -> [u8; 32] {
        let mut domain = k(b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)").to_vec();
        domain.extend_from_slice(&k(b"HyperliquidSignTransaction"));
        domain.extend_from_slice(&k(b"1"));
        domain.extend_from_slice(&word_u64(chain_id));
        domain.extend_from_slice(&[0u8; 32]);
        let mut st = k(type_sig.as_bytes()).to_vec();
        for f in fields {
            st.extend_from_slice(&encode(f));
        }
        let mut msg = vec![0x19, 0x01];
        msg.extend_from_slice(&k(&domain));
        msg.extend_from_slice(&k(&st));
        k(&msg)
    }

    pub const APPROVE_AGENT: &str = "HyperliquidTransaction:ApproveAgent(string hyperliquidChain,address agentAddress,string agentName,uint64 nonce)";
    pub const SEND_ASSET: &str = "HyperliquidTransaction:SendAsset(string hyperliquidChain,string destination,string sourceDex,string destinationDex,string token,string amount,string fromSubAccount,uint64 nonce)";
}

#[cfg(test)]
mod tests {
    use super::eip712::{APPROVE_AGENT, Field, SEND_ASSET, digest};
    use super::*;

    #[test]
    fn iso_roundtrip() {
        assert_eq!(iso_from_ms(1794373924370), "2026-11-11T05:12:04.370Z");
        assert_eq!(ms_from_iso("2026-11-11T05:12:04.370Z"), Some(1794373924370));
        assert_eq!(ms_from_iso("2026-11-11T05:12:04Z"), Some(1794373924000));
        assert_eq!(ms_from_iso("garbage"), None);
    }

    #[test]
    fn decimals() {
        assert_eq!(fmt_decimal(1_950_000_000, 8), "19.5");
        assert_eq!(fmt_decimal(2_000_000_000, 8), "20");
        assert_eq!(fmt_decimal(1, 8), "0.00000001");
    }

    // Vectors computed with viem hashTypedData (see PRD §8).
    #[test]
    fn hyperliquid_eip712_matches_viem() {
        let approve = digest(
            421614,
            APPROVE_AGENT,
            &[
                Field::Str("Testnet"),
                Field::Addr("0x828766accf9179c3b9da7a6939362ae185be1831"),
                Field::Str("nullpoint-keeper"),
                Field::U64(1794303016740),
            ],
        );
        assert_eq!(hex(&approve), "75c03c0d3ba30b48441aabb7525d4886c707cac4f72175f082ed64d9995cf70b");
        let send = digest(
            421614,
            SEND_ASSET,
            &[
                Field::Str("Mainnet"),
                Field::Str("0x1111111111111111111111111111111111111111"),
                Field::Str(""),
                Field::Str("spot"),
                Field::Str("USDC:0x6d1e7cde53ba9467b783cb7c530ce054"),
                Field::Str("19.5"),
                Field::Str(""),
                Field::U64(1794303016740),
            ],
        );
        assert_eq!(hex(&send), "580088b260bda01aa723b68f27de2d9e0d4267e83e9105451a50913dbe116765");
    }

    #[test]
    fn nonce_layout() {
        use base64::Engine;
        let n = versioned_nonce([0x25, 0x28, 0x12, 0xb3], 5, &[7u8; 15]);
        let b = base64::engine::general_purpose::STANDARD.decode(n).unwrap();
        assert_eq!(&b[..9], &[0x56, 0x28, 0xf6, 0xc6, 0, 0x25, 0x28, 0x12, 0xb3]);
        assert_eq!(i64::from_le_bytes(b[9..17].try_into().unwrap()), 5);
        assert_eq!(&b[17..], &[7u8; 15]);
    }
}
