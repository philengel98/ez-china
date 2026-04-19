import os
import ftplib
import sys

def upload_dir(ftp, src_dir, dst_dir):
    try:
        ftp.mkd(dst_dir)
    except ftplib.error_perm as e:
        if not str(e).startswith('550'):
            print(f"Error creating directory {dst_dir}: {e}")
            
    ftp.cwd(dst_dir)
    
    for item in os.listdir(src_dir):
        if item == '.DS_Store':
            continue
        src_item = os.path.join(src_dir, item)
        if os.path.isfile(src_item):
            print(f"Uploading {item}...")
            with open(src_item, 'rb') as f:
                ftp.storbinary(f'STOR {item}', f)
        elif os.path.isdir(src_item):
            print(f"Entering directory {item}...")
            upload_dir(ftp, src_item, item)
            ftp.cwd("..")

def main():
    host = "ez-china.bplaced.net"
    user = "ez-china"
    password = "kicfy7-bofryq-zaMwuz"
    
    local_dist = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
    
    if not os.path.exists(local_dist):
        print(f"Error: {local_dist} does not exist. Please build the project first.")
        sys.exit(1)

    print(f"Connecting to FTP {host} as {user}...")
    try:
        ftp = ftplib.FTP(host, user, password)
    except Exception as e:
        print(f"Failed to connect: {e}")
        sys.exit(1)
        
    print(f"Connected. Changing to 'www' directory...")
    try:
        ftp.cwd("www")
    except ftplib.error_perm:
        print("Warning: could not change to 'www' directory. It may not exist or might have wrong permissions.")
    
    print(f"Starting upload from {local_dist} to www...")
    
    for item in os.listdir(local_dist):
        if item == '.DS_Store':
            continue
            
        src_item = os.path.join(local_dist, item)
        if os.path.isfile(src_item):
            print(f"Uploading {item}...")
            with open(src_item, 'rb') as f:
                ftp.storbinary(f'STOR {item}', f)
        elif os.path.isdir(src_item):
            print(f"Entering directory {item}...")
            upload_dir(ftp, src_item, item)
            ftp.cwd("..")
            
    ftp.quit()
    print("Upload finished successfully!")

if __name__ == "__main__":
    main()
