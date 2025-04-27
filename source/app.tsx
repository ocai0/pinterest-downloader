import 'dotenv/config';
import React from 'react';
import {Text, Box, Newline} from 'ink';
import SelectInput from 'ink-select-input';
const PROGRAM_VERSION = 0.1

type Props = {
	[x: string]: string | undefined;
};

const handleSelect = async () => {

}

export default function App(_props: Props) {
	const commandList = [
		{
			label: 'folder',
			value: 'Download Folder'
		},
		{
			label: 'folder2',
			value: 'Download Folders'
		}
	]

	return (
		<Box>
			<Text color='blue'> 
				PinDown 
				<Newline />
				v{PROGRAM_VERSION}
				<Newline/>
			</Text>
			<Text>
				What you wanna do?
				<Newline/>
			</Text>
			<SelectInput items={commandList} onSelect={handleSelect} />
		</Box>
	);
}
