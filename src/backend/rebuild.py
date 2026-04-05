import core
data = core.load_data()
print(f"Found {len(data)} total instances in config.")

for name, inst in data.items():
    is_managed = inst.get("managed")
    print(f"Checking {name}: Managed={is_managed}")
    if is_managed:
        print(f"  -> Triggering rebuild for {name}...")
        core.recreate_managed_container(name, is_local=inst.get("is_local", False))